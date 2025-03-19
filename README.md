# QQ聊天记录导出工具 Pro

[![GPL3 License](https://img.shields.io/badge/License-GPL3-4a5568?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Release](https://img.shields.io/github/v/release/shuakami/qq-chat-exporter?include_prereleases&style=flat-square&color=667eea)](https://github.com/shuakami/qq-chat-exporter/releases) 
![Platform](https://img.shields.io/badge/平台-Windows-48bb78?style=flat-square)
[![使用教程](https://img.shields.io/badge/使用教程-点击查看-f6ad55?style=flat-square)](https://qce.luoxiaohei.cn)

## 这是什么

它是一个QQ聊天记录导出**方案**，然后把它QQ内显示的消息/图片/视频正确的导出为TXT/JSON格式给你。

他和其他的方案相比就是全自动、较为简单。

前提是你得有一台可以使用的，Windows10以上的电脑。

## 快速开始

[文档](https://qce.luoxiaohei.cn)

## 工作原理

众所周知，最新版本QQ NT基于**Electron**，而Electron本质上是将**Chromium**和**Node.js**结合到一起的框架。这意味着QQ NT实际上是一个**网页应用**，其界面元素都是**DOM节点**。

这个特性给了我一个突破口。

我们利用 [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT) 的 **Chii DevTools插件**，它能调出Chromium的开发者工具(DevTools)。

然后我们在控制台中注入并执行我们的**自定义脚本**。

这个脚本是整个方案的**核心**，它会遍历DOM节点收集聊天记录元素，自动模拟滚动以加载更早的历史消息。

每滚动一次，它就会分析页面上新出现的消息元素，提取出**发送时间**、**发送者**、**内容**等信息。

然后将收集到的聊天记录存储到浏览器的**IndexedDB数据库**中，这样即使页面刷新了数据也不会丢失。最后通过**Web Worker**异步处理数据并提供导出功能，支持**JSON**和**TXT**两种格式。

这种方法直接操作QQ NT的网页界面，**无需反编译应用**，也**不需要访问QQ的加密数据库文件**。

它对腾讯服务器**完全无感知**，因为我们只是在本地模拟用户操作，然后收集它渲染出来的消息。如果你担心安全问题，可以自己检查我们的源码，里面**没有任何网络请求**，数据完全存在你自己电脑上。

## 旧版本

如果怕被封，可以使用旧版本(Python版)：
- 下载地址：[v1.0.0](https://github.com/shuakami/qq-chat-exporter/releases/tag/v1.0.0)
- 使用说明：[查看文档](https://github.com/shuakami/qq-chat-exporter/tree/144c3e74c658b2822ad36ac6423d84716b0519b5)

旧版本功能有限，无法导出图片，而且稍繁琐一些。

## 免责声明

**请务必仔细阅读以下免责声明：**

1. 本项目仅供学习交流使用，严禁用于任何商业用途和非法目的。
2. 本项目与腾讯公司及其关联公司无任何关联，非官方工具。
3. 使用本工具导出个人聊天记录可能违反QQ用户协议，可能导致账号被封禁等风险，由用户自行承担。
4. 请勿将导出的聊天记录用于违反隐私、诽谤、骚扰等侵犯他人合法权益的行为。
5. 本项目开发者不对使用本工具导致的任何直接或间接损失负责，包括但不限于账号安全问题、数据丢失等。
6. 如果腾讯公司认为本项目侵犯了其合法权益，请联系我处理。

**继续使用即表示您已阅读并同意上述免责声明的全部内容。如不同意，请立即停止使用。**

## 许可证

本项目采用 [GNU通用公共许可证 v3 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html) 开源。

如果有帮到你，顺手点个star呗～

没帮到你也欢迎来issue区骂我，狠狠鞭策我～