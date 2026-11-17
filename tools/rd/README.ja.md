<p align="center"><img src="../../design/v02/media/rd-icon.svg" width="88" alt="DocsBridge"></p>
<h1 align="center">DocsBridge</h1>
<p align="center">フィードバックを、もっとシンプルに。</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · 日本語 · <a href="../../website/README.md">製品サイト ↗</a></p>

文書を公開し、リンクを共有する。すべての提案が、該当する文章のそばに残ります。
DocsBridge は、読むことを大切にしたセルフホスト型の文書レビューツールです。注釈は小さな点に折りたたまれ、公開版は固定されます。後で見直すときも、元の文脈を確認できます。

**ローカル版 0.2.2 · macOS Apple Silicon / Intel · Windows x64 / ARM64。**
プロジェクトのフォルダー名は `RD`、実行ファイルとパッケージ名は `pangzhu` です。アプリの UI は現在中国語です。README と製品サイトは英語・簡体字中国語・日本語に対応しています。

## はじめに

1. `python3 scripts/package_release.py` でポータブル版をビルドするか、`dist/` に用意された対応パッケージを使います。ローカルのリリース記録では一般公開は準備段階です。公開ダウンロードの提供は保証していません。
2. `pangzhu-0.2.2-<darwin|windows>-<arm64|amd64>.zip` を書き込み可能なフォルダーに展開します。
3. **macOS** は **Start-Pangzhu.command**、**Windows** は **Start-Local.cmd** を開きます。使用中はターミナル／コンソールを開いたままにしてください。
4. **⋯** メニューから文書を編集して公開します。一時的な公開レビューリンクが必要な場合は **Start-Share.command**（macOS）または **Start-Share.cmd**（Windows）を実行します。

パッケージにはサービスと cloudflared が含まれます。レビュアーに必要なのはブラウザーだけです。macOS 版はコマンドランチャーで、署名・公証済みの `.app` ではありません。Windows 版は Authenticode 未署名です。ARM64 版のコネクターには x64 エミュレーションが必要です。Windows 実機での検証は未完了です。

[macOS ガイド（英語）](docs/macos.md) · [Windows ガイド（英語）](docs/windows.md) · [リリース準備（英語）](docs/releases.md)

## 文書に、もっと余白を。

- **心地よく読む。** 連続表示と A4 ページ表示を切り替え、文字サイズ、行間、段落間隔、紙の色を調整できます。原稿の書式は変わりません。
- **言葉を指定して提案する。** 文章を選択して提案を残します。閉じると小さな点になり、開くと元の文章が強調されます。パネルは文章を隠さないように配置されます。
- **フィードバックを一か所に。** レビュアーは固定された公開版に注釈を付け、著者がまとめて対応できます。過去の提案は元の版に残り、新しい版へ自動移動しません。
- **下書きを分けて保存する。** ブラウザー内で文書を作成・切り替えできます。Cmd+S / Ctrl+S で `.rd` ファイルを保存し、バックアップや別の端末での編集に使えます。
- **コピーを持ち出す。** 単独で開ける HTML を書き出すか、PDF 書き出しからブラウザーの「PDF として保存」を使います。PDF には現在の本文と任意の透かしが含まれ、注釈は含まれません。

`.rd` の読み込みや保存だけでは公開されません。オフライン HTML はサーバーと同期しません。現在、データディレクトリごとにレビュー対象の公開文書は一つです。サーバー側の複数文書ライブラリーはありません。

## 共有の範囲

一時共有には Cloudflare のアカウント、ドメイン、トークンは不要です。接続確認後に `trycloudflare.com` のリンクを表示します。アドレスは起動ごとに変わり、ホストは起動・スリープ解除した状態を保つ必要があります。一時共有は三秒間隔で更新を確認し、稼働率の保証はありません。固定ドメインには設定済みの名前付きトンネルを、信頼できる LAN には `Start-LAN.cmd` を使います。

公開レビュー URL を知る人は、最新の公開版を閲覧し注釈を付けられます。レビュアーのラベルは認証されたアカウントではありません。公開前の下書きはブラウザーに、公開版と提案はホストの SQLite データディレクトリに保存されます。`.rd` と、サービス停止中の `data/` をそれぞれバックアップしてください。

## ソースから実行・検証

Go 1.27.3 以降、Python 3、Node.js を用意し、プロジェクトのルートで実行します。

```sh
python3 design/build.py
go build -o bin/pangzhu ./cmd/pangzhu
./bin/pangzhu --data-dir ./data
```

ホストの `http://127.0.0.1:8765/` で編集できます。`/review` は閲覧とフィードバック専用です。Windows では出力先を `bin/pangzhu.exe` に変更してください。Go と SQLite を使用し、C ランタイムは不要です。プロジェクト概要（英語）。

```sh
npm ci
npx playwright install chromium
go test -race ./...
go vet ./...
npm run test:ui
python3 scripts/smoke_update.py
python3 scripts/package_release.py
python3 scripts/verify_packages.py
```

テストには一時データを使用します。クロスコンパイルは Windows 実機や実際のトンネル接続の検証ではありません。検証記録（英語）に根拠と制限を記載しています。

## 製品サイト

CallBridge のシンプルなブランド紹介と操作デモを参考にした、三言語のサイトです。サンプルを操作でき、フィードバックをサーバーへ送信しません。ローカルでビルド・表示できます。

```sh
python3 website/build.py
python3 -m http.server 8790 --bind 127.0.0.1 --directory dist/site
```

`http://127.0.0.1:8790/ja/` を開いてください。サイトの編集と検証（英語）。このコマンドはホスティングの設定や公開を行いません。

## 更新とライセンス

Standalone online updates are disabled in this Toolbox distribution. Obtain new ZIPs from [Toolbox releases](https://github.com/storyon403-afk/toolbox/releases); back up data before replacement.

プロジェクト全体のオープンソースライセンスは未選定です。同梱の第三者ライセンスは、DocsBridge 独自のソースの利用を許諾するものではありません。

[文書ファイル（英語）](docs/product/rd-files.md) · 製品体験（英語） · 構成（英語） · [変更履歴（英語）](CHANGELOG.md)
