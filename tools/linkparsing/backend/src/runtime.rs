//! Shared executable discovery for CLI and desktop hosts.
use std::path::{Path, PathBuf};

pub fn tool(name: &str) -> PathBuf {
    if matches!(name, "python" | "python3") {
        if let Some(path) = std::env::var_os("LINKPARSING_PYTHON") {
            return PathBuf::from(path);
        }
    }
    let key = format!("LINKPARSING_{}", name.to_uppercase().replace('-', "_"));
    if let Some(path) = std::env::var_os(key) {
        return PathBuf::from(path);
    }
    #[allow(unused_mut)]
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|p| p.is_absolute())
                .collect()
        })
        .unwrap_or_default();
    #[cfg(unix)]
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    #[cfg(windows)]
    let names = [format!("{name}.exe")];
    #[cfg(not(windows))]
    let names = [name.to_owned()];
    dirs.into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(&names[0]))
}

pub fn python(root: &Path) -> PathBuf {
    std::env::var_os("LINKPARSING_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            root.join(if cfg!(windows) {
                ".venv/Scripts/python.exe"
            } else {
                ".venv/bin/python"
            })
        })
}

pub fn model_directory() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
            .join("LinkParsing/Models")
    } else {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join("Library/Application Support/LinkParsing/Models")
    }
}
