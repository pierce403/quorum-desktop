use std::env;
use std::process::{Command, exit};

fn setup_env(cmd: &mut Command) {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let sysroot_lib = format!("{}/.local/tauri-dev-sysroot/usr/lib/x86_64-linux-gnu", home);
    let sysroot_pkg = format!("{}/.local/tauri-dev-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig", home);
    let sysroot_share_pkg = format!("{}/.local/tauri-dev-sysroot/usr/share/pkgconfig", home);

    let current_pkg = env::var("PKG_CONFIG_PATH").unwrap_or_default();
    let new_pkg = format!("{}:{}:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:{}", sysroot_pkg, sysroot_share_pkg, current_pkg);
    cmd.env("PKG_CONFIG_PATH", new_pkg);

    let current_lib = env::var("LIBRARY_PATH").unwrap_or_default();
    let new_lib = format!("{}:{}", sysroot_lib, current_lib);
    cmd.env("LIBRARY_PATH", new_lib);

    let current_rustflags = env::var("RUSTFLAGS").unwrap_or_default();
    let new_rustflags = format!("-L native={} {}", sysroot_lib, current_rustflags);
    cmd.env("RUSTFLAGS", new_rustflags);
}

fn run_command(program: &str, args: &[&str]) {
    let mut cmd = Command::new(program);
    cmd.args(args);
    setup_env(&mut cmd);
    let status = cmd.status().unwrap_or_else(|err| {
        eprintln!("Failed to execute {}: {}", program, err);
        exit(1);
    });
    if !status.success() {
        exit(status.code().unwrap_or(1));
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let task = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match task {
        "dev" => {
            println!("Starting Quorum Desktop in dev mode...");
            run_command("yarn", &["tauri", "dev"]);
        }
        "build" => {
            println!("Building Quorum Desktop...");
            run_command("yarn", &["tauri", "build"]);
        }
        "test" => {
            println!("Running Quorum Desktop test suite...");
            run_command("yarn", &["test:run"]);
        }
        _ => {
            println!("Quorum Desktop build orchestrator\n");
            println!("Usage: cargo xtask <command>\n");
            println!("Commands:");
            println!("  dev     Run the app in development mode (Vite + Tauri)");
            println!("  build   Build the release desktop binary and packages");
            println!("  test    Run Vitest test suite");
        }
    }
}
