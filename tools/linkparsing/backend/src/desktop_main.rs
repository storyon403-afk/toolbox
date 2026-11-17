#![forbid(unsafe_code)]
use linkparsing_core::{
    Error,
    desktop::{Command, Request, Session, configured_tools},
};
use serde_json::{Value, json};
use std::{
    io::{BufRead, Write},
    sync::Arc,
};
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;

// stdout is a private IPC pipe, never a diagnostic log. stderr contains no input.
fn respond(id: u64, result: linkparsing_core::Result<Value>) {
    let value = match result {
        Ok(data) => json!({"id": id, "ok": true, "data": data}),
        Err(error) => json!({"id": id, "ok": false, "error": {
            "code": match &error {
                Error::Cancelled => "cancelled".to_owned(),
                Error::Platform(kind) => serde_json::to_value(kind).unwrap_or_default().as_str().unwrap_or("platform_error").to_owned(),
                _ => "request_failed".to_owned(),
            }, "message": error.to_string()
        }}),
    };
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}

#[tokio::main]
async fn main() {
    let tools = match configured_tools() {
        Ok(tools) => tools,
        Err(error) => {
            respond(0, Err(error));
            return;
        }
    };
    let session = Arc::new(Mutex::new(Session::new(tools)));
    let (sender, mut receiver) = mpsc::channel(8);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let mut line = Vec::new();
            // Fail closed on oversized messages, without allocating unbounded memory.
            let read = std::io::Read::take(&mut input, 65537).read_until(b'\n', &mut line);
            if !matches!(read, Ok(n) if n > 0 && n <= 65536) {
                break;
            }
            let value = serde_json::from_slice::<Value>(&line);
            let id = value
                .as_ref()
                .ok()
                .and_then(|v| v.get("id"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let request = value.and_then(serde_json::from_value::<Request>);
            if sender.blocking_send((id, request)).is_err() {
                break;
            }
        }
    });
    let shutdown = CancellationToken::new();
    let signal = shutdown.clone();
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            if let Ok(mut terminate) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                tokio::select! { _ = terminate.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
            } else {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        signal.cancel();
    });
    let mut jobs = tokio::task::JoinSet::new();
    let mut token = CancellationToken::new();
    loop {
        tokio::select! {
            biased;
            _ = shutdown.cancelled() => break,
            _ = jobs.join_next(), if !jobs.is_empty() => {},
            message = receiver.recv() => {
                let Some((id, message)) = message else { break; };
                let request = match message {
                    Ok(request) => request,
                    Err(_) => { respond(id, Err(Error::Invalid("invalid desktop request"))); continue; }
                };
                if matches!(request.command, Command::Cancel) {
                    token.cancel();
                    respond(request.id, Ok(json!({"cancelling": !jobs.is_empty()})));
                    continue;
                }
                if !jobs.is_empty() {
                    respond(request.id, Err(Error::Invalid("another task is running")));
                    continue;
                }
                token = CancellationToken::new();
                let cancel = token.clone();
                let state = session.clone();
                jobs.spawn(async move {
                    let result = state.lock().await.execute(request.command, &cancel, |data| {
                        let mut stdout = std::io::stdout().lock();
                        let value = json!({"id": request.id, "event": "progress", "data": data});
                        let _ = writeln!(stdout, "{value}");
                        let _ = stdout.flush();
                    }).await;
                    respond(request.id, result);
                });
            }
        }
    }
    token.cancel();
    while jobs.join_next().await.is_some() {}
    // Session drops private snapshots before process exit; published downloads/exports remain.
}
