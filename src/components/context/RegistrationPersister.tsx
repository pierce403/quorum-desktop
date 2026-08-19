import React, {
  createContext,
  FC,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useRegistration } from '../../hooks';
import {
  passkey,
  channel as secureChannel,
  usePasskeysContext,
} from '@quilibrium/quilibrium-js-sdk-channels';
import { useUploadRegistration } from '../../hooks/mutations/useUploadRegistration';
import { Button, Icon } from '../primitives';
import { useMessageDB } from './useMessageDB';
import { useQuorumApiClient } from './QuorumApiContext';
import { t } from '@lingui/core/macro';
import { getDefaultUserConfig } from '../../utils';
import { logRegistrationEvent } from '../../utils/devDiagnostics';
import { loadKeyDecryptDataSafely } from '../../utils/keyDB';

type LocalKeyset = {
  userKeyset: secureChannel.UserKeyset;
  deviceKeyset: secureChannel.DeviceKeyset;
};

type DeviceRepairState = 'idle' | 'required' | 'repairing' | 'failed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadLocalKeyset(userKey: Uint8Array): Promise<LocalKeyset> {
  const data = await loadKeyDecryptDataSafely(2);
  const envelope: unknown = JSON.parse(Buffer.from(data).toString('utf-8'));
  if (
    !isRecord(envelope) ||
    !Array.isArray(envelope.ciphertext) ||
    !Array.isArray(envelope.iv)
  ) {
    throw new DOMException('Invalid device keyset envelope', 'DataError');
  }

  const key = await passkey.createKeyFromBuffer(
    userKey as unknown as ArrayBuffer
  );
  const decrypted = await passkey.decrypt(
    new Uint8Array(envelope.ciphertext),
    new Uint8Array(envelope.iv),
    key
  );
  const inner: unknown = JSON.parse(Buffer.from(decrypted).toString('utf-8'));
  if (!isRecord(inner) || !inner.identity || !inner.device) {
    throw new DOMException('Invalid device keyset', 'DataError');
  }

  return {
    userKeyset: inner.identity as secureChannel.UserKeyset,
    deviceKeyset: inner.device as secureChannel.DeviceKeyset,
  };
}

async function persistLocalKeyset(
  userKey: Uint8Array,
  localKeyset: LocalKeyset
): Promise<void> {
  const key = await passkey.createKeyFromBuffer(
    userKey as unknown as ArrayBuffer
  );
  const inner = await passkey.encrypt(
    Buffer.from(
      JSON.stringify({
        identity: localKeyset.userKeyset,
        device: localKeyset.deviceKeyset,
      }),
      'utf-8'
    ),
    key
  );
  const envelope = Buffer.from(
    JSON.stringify({
      iv: [...inner.iv],
      ciphertext: [...new Uint8Array(inner.ciphertext)],
    }),
    'utf-8'
  );
  await passkey.encryptDataSaveKey(2, envelope);
}

async function createReplacementLocalKeyset(
  userKey: Uint8Array,
  publicKeyHex: string
): Promise<LocalKeyset> {
  return {
    userKeyset: secureChannel.NewUserKeyset({
      type: 'ed448',
      private_key: [...userKey],
      public_key: [...new Uint8Array(Buffer.from(publicKeyHex, 'hex'))],
    }),
    deviceKeyset: await secureChannel.NewDeviceKeyset(),
  };
}

type RegistrationContextValue = {
  keyset: {
    userKeyset: secureChannel.UserKeyset;
    deviceKeyset: secureChannel.DeviceKeyset;
  };
};

type RegistrationContextProps = {
  children: ReactNode;
};

const RegistrationProvider: FC<RegistrationContextProps> = ({ children }) => {
  const { currentPasskeyInfo, exportKey } = usePasskeysContext();
  const [clickRestore, setClickRestore] = useState(false);
  const [deviceRepairState, setDeviceRepairState] =
    useState<DeviceRepairState>('idle');
  const [init, setInit] = useState(false);
  const { keyset, setKeyset, setSelfAddress, getConfig, saveConfig } =
    useMessageDB();
  const { data: registration } = useRegistration({
    address: currentPasskeyInfo!.address,
  });
  const { apiClient } = useQuorumApiClient();
  const uploadRegistration = useUploadRegistration();

  const repairDevice = async (
    passedUserKey?: Uint8Array
  ): Promise<LocalKeyset> => {
    setDeviceRepairState('repairing');
    logRegistrationEvent({
      stage: 'decrypt-device-keyset',
      outcome: 'recovering',
      registered: true,
    });

    try {
      const userKey =
        passedUserKey ??
        new Uint8Array(
          Buffer.from(await exportKey(currentPasskeyInfo!.address), 'hex')
        );
      const replacement = await createReplacementLocalKeyset(
        userKey,
        currentPasskeyInfo!.publicKey
      );
      let existing: secureChannel.UserRegistration | undefined;
      try {
        existing =
          registration?.registration ??
          (await apiClient.getUser(currentPasskeyInfo!.address))?.data;
      } catch {
        /* ignore network failure */
      }

      const senderRegistration = await secureChannel.ConstructUserRegistration(
        replacement.userKeyset,
        existing?.device_registrations ?? [],
        [replacement.deviceKeyset]
      );

      // Persist first. If the network upload fails, the normal startup sync
      // will retry this exact local device rather than rotating it again.
      await persistLocalKeyset(userKey, replacement);
      try {
        await uploadRegistration({
          address: currentPasskeyInfo!.address,
          registration: senderRegistration,
        });
      } catch {
        /* ignore upload failure */
      }

      setSelfAddress(currentPasskeyInfo!.address);
      setKeyset(replacement);
      setDeviceRepairState('idle');
      logRegistrationEvent({
        stage: 'decrypt-device-keyset',
        outcome: 'succeeded',
        registered: true,
      });

      // Config initialization is useful but must not undo a completed device
      // repair if a separate config read happens to be offline.
      void (async () => {
        try {
          const userConfig = await getConfig({
            address: currentPasskeyInfo!.address,
            userKey: replacement.userKeyset,
          });
          if (userConfig === undefined) {
            await saveConfig({
              config: getDefaultUserConfig(currentPasskeyInfo!.address),
              keyset: replacement,
            });
          }
        } catch {
          logRegistrationEvent({
            stage: 'initialize-config',
            outcome: 'failed',
            registered: true,
          });
        }
      })();

      return replacement;
    } catch (e) {
      setDeviceRepairState('failed');
      logRegistrationEvent({
        stage: 'decrypt-device-keyset',
        outcome: 'failed',
        registered: true,
      });
      throw e;
    }
  };

  useEffect(() => {
    if (!init) {
      setInit(true);

      if (!registration?.registered) {
        setTimeout(
          () =>
            (async () => {
              let user_key: Uint8Array;
              try {
                logRegistrationEvent({
                  stage: 'export-account-key',
                  outcome: 'started',
                  registered: false,
                });
                user_key = new Uint8Array(
                  Buffer.from(
                    await exportKey(currentPasskeyInfo!.address),
                    'hex'
                  )
                );
                logRegistrationEvent({
                  stage: 'export-account-key',
                  outcome: 'succeeded',
                  registered: false,
                });
              } catch (e: any) {
                logRegistrationEvent({
                  stage: 'export-account-key',
                  outcome: 'failed',
                  registered: false,
                });
                if (e.name === 'NotAllowedError') {
                  setClickRestore(true);
                  return;
                } else {
                  throw e;
                }
              }
              try {
                logRegistrationEvent({
                  stage: 'load-device-keyset',
                  outcome: 'started',
                  registered: false,
                });
                const localKeyset = await loadLocalKeyset(user_key);
                logRegistrationEvent({
                  stage: 'load-device-keyset',
                  outcome: 'succeeded',
                  registered: false,
                });
                const senderIdent = localKeyset.userKeyset;
                const senderDevice = localKeyset.deviceKeyset;
                let existing: secureChannel.UserRegistration | undefined;
                try {
                  existing = (
                    await apiClient.getUser(currentPasskeyInfo!.address)
                  )?.data;
                } catch {
                  /* ignore */
                }

                const senderRegistration =
                  await secureChannel.ConstructUserRegistration(
                    senderIdent,
                    existing?.device_registrations ?? [],
                    [senderDevice]
                  );
                uploadRegistration({
                  address: currentPasskeyInfo!.address,
                  registration: senderRegistration,
                });
              } catch (e) {
                const senderIdent = secureChannel.NewUserKeyset({
                  type: 'ed448',
                  private_key: [...user_key],
                  public_key: [
                    ...new Uint8Array(
                      Buffer.from(currentPasskeyInfo!.publicKey, 'hex')
                    ),
                  ],
                });
                const senderDevice = await secureChannel.NewDeviceKeyset();
                let existing: secureChannel.UserRegistration | undefined;
                try {
                  existing = (
                    await apiClient.getUser(currentPasskeyInfo!.address)
                  )?.data;
                } catch {
                  /* ignore */
                }

                const senderRegistration =
                  await secureChannel.ConstructUserRegistration(
                    senderIdent,
                    existing?.device_registrations ?? [],
                    [senderDevice]
                  );
                await persistLocalKeyset(user_key, {
                  userKeyset: senderIdent,
                  deviceKeyset: senderDevice,
                });
                uploadRegistration({
                  address: currentPasskeyInfo!.address,
                  registration: senderRegistration,
                });
              }
            })(),
          200
        );
      } else {
        setTimeout(
          () =>
            (async () => {
              try {
                logRegistrationEvent({
                  stage: 'export-account-key',
                  outcome: 'started',
                  registered: true,
                });
                const user_key = new Uint8Array(
                  Buffer.from(
                    await exportKey(currentPasskeyInfo!.address),
                    'hex'
                  )
                );
                logRegistrationEvent({
                  stage: 'export-account-key',
                  outcome: 'succeeded',
                  registered: true,
                });
                logRegistrationEvent({
                  stage: 'load-device-keyset',
                  outcome: 'started',
                  registered: true,
                });
                let localKeyset: LocalKeyset;
                try {
                  localKeyset = await loadLocalKeyset(user_key);
                } catch {
                  logRegistrationEvent({
                    stage: 'decrypt-device-keyset',
                    outcome: 'failed',
                    registered: true,
                  });
                  localKeyset = await repairDevice(user_key);
                }
                logRegistrationEvent({
                  stage: 'load-device-keyset',
                  outcome: 'succeeded',
                  registered: true,
                });
                const senderIdent = localKeyset.userKeyset;
                const senderDevice = localKeyset.deviceKeyset;
                if (
                  !registration?.registration?.device_registrations.find(
                    (d: secureChannel.DeviceRegistration) =>
                      d.inbox_registration.inbox_address ==
                      senderDevice.inbox_keyset.inbox_address
                  )
                ) {
                  let existing: secureChannel.UserRegistration | undefined;
                  try {
                    existing = (
                      await apiClient.getUser(currentPasskeyInfo!.address)
                    )?.data;
                  } catch {
                    /* ignore */
                  }
                  const senderRegistration =
                    await secureChannel.ConstructUserRegistration(
                      senderIdent,
                      existing?.device_registrations ?? [],
                      [senderDevice]
                    );
                  uploadRegistration({
                    address: currentPasskeyInfo!.address,
                    registration: senderRegistration,
                  });
                }
                setSelfAddress(currentPasskeyInfo!.address);
                setKeyset({
                  deviceKeyset: senderDevice,
                  userKeyset: senderIdent,
                });
                const userConfig = await getConfig({
                  address: currentPasskeyInfo!.address,
                  userKey: senderIdent,
                });
                if (userConfig === undefined) {
                  const defaultConfig = getDefaultUserConfig(
                    currentPasskeyInfo!.address
                  );
                  saveConfig({
                    config: defaultConfig,
                    keyset: localKeyset,
                  });
                }
              } catch (e: any) {
                if (e.name === 'NotAllowedError') {
                  setClickRestore(true);
                } else {
                  throw e;
                }
              }
            })(),
          200
        );
      }
    }
  }, [init, registration]);

  return (
    <RegistrationContext.Provider
      value={{
        keyset,
      }}
    >
      {!clickRestore && deviceRepairState === 'idle' && children}
      {!clickRestore && deviceRepairState !== 'idle' && (
        <>
          <div className="flex flex-col grow"></div>
          <div className="flex flex-col select-none">
            <div className="flex flex-row grow"></div>
            <div className="flex flex-row grow font-semibold text-2xl">
              <div className="flex flex-col grow"></div>
              <div className="flex flex-col">{t`Repair this device`}</div>
              <div className="flex flex-col grow"></div>
            </div>
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] py-4 text-center">
                <Icon name="warning" size="4xl" />
              </div>
              <div className="grow"></div>
            </div>
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] py-4 text-justify">
                {t`Your account was restored, but this device's encrypted messaging keys can no longer be opened. Repairing creates a new device session without changing your account key.`}
              </div>
              <div className="grow"></div>
            </div>
            {deviceRepairState === 'failed' && (
              <div className="flex flex-row justify-center">
                <div className="w-[460px] py-2 text-center text-danger">
                  {t`The repair could not be completed. Check your connection and try again.`}
                </div>
              </div>
            )}
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] pt-4 text-center">
                <Button
                  type="primary"
                  className="px-8"
                  disabled={deviceRepairState === 'repairing'}
                  onClick={() => void repairDevice()}
                >
                  {deviceRepairState === 'repairing'
                    ? t`Repairing…`
                    : t`Repair this device`}
                </Button>
              </div>
              <div className="grow"></div>
            </div>
          </div>
          <div className="flex flex-col grow"></div>
        </>
      )}
      {clickRestore && (
        <>
          <div className="flex flex-col grow"></div>
          <div className="flex flex-col select-none">
            <div className="flex flex-row grow"></div>
            <div className="flex flex-row grow font-semibold text-2xl">
              <div className="flex flex-col grow"></div>
              <div className="flex flex-col">{t`Session Encrypted`}</div>
              <div className="flex flex-col grow"></div>
            </div>
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] py-4 text-center">
                <Icon name="lock" size="4xl" />
              </div>
              <div className="grow"></div>
            </div>
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] py-4 text-justify">
                {t`Quorum was loaded while the browser was not in focus or a passkey request was rejected. Please reauthorize to access your messages.`}
              </div>
              <div className="grow"></div>
            </div>
            <div className="flex flex-row justify-center">
              <div className="grow"></div>
              <div className="w-[460px] pt-4 text-center">
                <Button
                  type="primary"
                  className="px-8"
                  onClick={() => {
                    setInit(false);
                    setClickRestore(false);
                  }}
                >
                  {t`Reauthorize`}
                </Button>
              </div>
              <div className="grow"></div>
            </div>
            <div className="flex flex-row grow"></div>
          </div>
          <div className="flex flex-col grow"></div>
        </>
      )}
    </RegistrationContext.Provider>
  );
};

const RegistrationContext = createContext<RegistrationContextValue>({
  keyset: undefined as never,
});

export { RegistrationProvider, RegistrationContext };
