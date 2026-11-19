<p align="center"><img src="website/media/mark.svg" width="88" alt="Toolbox"></p>
<h1 align="center">Toolbox</h1>
<p align="center">一些小工具，说不定对你有用。</p>
<p align="center"><a href="README.md">English</a> · 简体中文 · <a href="https://storyon403-afk.github.io/toolbox/?lang=zh-CN">看看工具 ↗</a></p>

改文档、画界面、记生词，或是把视频里的内容取出来。遇到这些小事时，也许用得上。

## 能帮你做什么？

| 工具 | 什么时候用得上 |
| --- | --- |
| [RD · DocsBridge](tools/rd/README.zh-CN.md) | 请人帮忙看稿时，让修改意见直接留在对应的原文旁边。 |
| [DesignDoc · Forma](tools/designdoc/design-canvas/README.md) | 有个应用想法时，先画出界面，再连成可以点击的原型。 |
| [LanguageMap](tools/languagemap/README.md) | 学到生词时，写下释义、连起相关词语，以后按日期翻看。 |
| [LinkParsing · LinkParse](tools/linkparsing/README.md) | 整理视频时，把讲话转成文字，提取画面文字、音频或截图。 |

每个工具都可以单独用，Toolbox 把它们放在一起。

## 怎么开始？

在 [Releases](https://github.com/storyon403-afk/toolbox/releases/latest) 下载 Windows 11 x64 安装包。解压后打开 `Toolbox.exe`，在设置中检查更新即可加载工具目录。四个工具也提供独立 ZIP。当前版本未签名；依赖和功能范围见[安装说明](docs/INSTALL.md)。

从源码启动 Toolbox，需要 Node.js 22.12 或更新版本：

```sh
npm ci
npm run setup
npm start
```

[构建与检查](docs/BUILD.md) · [发行准备](docs/RELEASING.md) · [预览展示网页](website/README.md)
