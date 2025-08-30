# QQ聊天记录导出工具 Pro

[![GPL3 License](https://img.shields.io/badge/License-GPL3-4a5568?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Release](https://img.shields.io/github/v/release/shuakami/qq-chat-exporter?include_prereleases&style=flat-square&color=667eea)](https://github.com/shuakami/qq-chat-exporter/releases) 
![Platform](https://img.shields.io/badge/平台-Win/Mac/Linux-48bb78?style=flat-square)
[![使用教程](https://img.shields.io/badge/使用教程-点击查看-f6ad55?style=flat-square)](https://qce.luoxiaohei.cn)

## 这是什么

它是一个QQ聊天记录导出**工具**，把QQ内显示的消息/图片/表情等等正确的导出为**HTML**、**JSON**、**TXT**格式给你。

**V3版本**用Go重写了，比之前稳定太多了。最大的好处是支持**断点续传**和**实时保存**，再也不怕导一半程序崩了。

他和其他的方案相比就是全自动、较为简单。

## 快速开始

[文档](https://qce.luoxiaohei.cn)

## 工作原理

### V3版本怎么工作的

**V3版本**是用Go重新写的，不再像以前那样在浏览器里搞了。

现在的思路很简单：我们通过**NapCat**这个中间件来跟QQ说话。NapCat相当于是给QQ装了个**API接口**，我们的程序就通过**WebSocket**连上去，然后用标准的方式问QQ要聊天记录。

最关键的改进是现在用**SQLite数据库**来存消息了。以前的版本导出到一半如果崩了，你就得从头开始。现在不会了，每30秒自动保存一次，程序崩了重新运行也能从断点继续。

导出的时候支持**HTML**、**JSON**、**TXT**三种格式。HTML的样式我做成了苹果那种简洁风格，看起来还挺舒服的。

### V2版本怎么工作的（旧方法）

众所周知，最新版本QQ NT基于**Electron**，而Electron本质上是将**Chromium**和**Node.js**结合到一起的框架。这意味着QQ NT实际上是一个**网页应用**，其界面元素都是**DOM节点**。

这个特性给了我一个突破口。

我们利用 [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT) 的 **Chii DevTools插件**，它能调出Chromium的开发者工具(DevTools)。

然后我们在控制台中注入并执行我们的**自定义脚本**。

这个脚本是整个方案的**核心**，它会遍历DOM节点收集聊天记录元素，自动模拟滚动以加载更早的历史消息。

每滚动一次，它就会分析页面上新出现的消息元素，提取出**发送时间**、**发送者**、**内容**等信息。

然后将收集到的聊天记录存储到浏览器的**IndexedDB数据库**中，这样即使页面刷新了数据也不会丢失。最后通过**Web Worker**异步处理数据并提供导出功能，支持**JSON**和**TXT**两种格式。

### 为什么V3更好

V3比V2稳定太多了。V2那种在浏览器里滚动页面的方法，虽然很巧妙，但是容易因为各种原因卡住或者崩溃。

V3直接用API拿数据，就像正常的软件一样，稳定性不是一个级别的。而且有了数据库，支持断点续传，体验好太多了。

不管用哪个版本，数据都是在你自己电脑上处理的，**没有任何网络请求**，腾讯服务器完全感知不到。我们只是用标准方式拿你自己的数据，然后在本地处理。

## 版本历史

### V2版本：JavaScript方案
基于DOM操作的浏览器端解决方案，通过DevTools注入脚本实现数据采集。该版本支持图片导出，操作相对简单，但稳定性受限于浏览器环境。

**V2版本代码：** [查看提交](https://proxy.sdjz.wiki/shuakami/qq-chat-exporter/commit/a257756a22febfba783e8ce5926c5382f81e57f6)

### V1版本：Python方案  
最初的Python实现版本，采用更保守的技术路线。虽然功能相对基础且无法导出图片，但在某些环境下具有更好的兼容性。

**下载地址：** [v1.0.0](https://github.com/shuakami/qq-chat-exporter/releases/tag/v1.0.0)  
**使用文档：** [查看说明](https://github.com/shuakami/qq-chat-exporter/tree/144c3e74c658b2822ad36ac6423d84716b0519b5)

## 免责声明

**请务必仔细阅读以下免责声明：**

本项目仅供**个人学习研究**和**数据备份**使用，严禁用于任何商业用途和非法目的。项目与腾讯公司无任何关联，属于**非官方第三方工具**。

使用本工具可能违反QQ用户协议。根据最新反馈，腾讯通常采用**警告提示**而非封号处理，但政策可能随时调整。**V3版本**通过优化请求策略显著降低了风控触发概率，但用户仍需**自行承担使用风险**。

请严格遵守**数据隐私**原则，仅导出本人聊天记录，不得用于侵犯他人隐私、诽谤、骚扰等违法行为。导出的数据应妥善保管，避免泄露或滥用。

开发者不对使用本工具导致的**任何直接或间接损失**负责，包括但不限于账号安全、数据丢失、法律风险等问题。用户应充分评估风险并采取适当的防护措施。

如腾讯公司认为本项目存在不当之处，欢迎通过正当渠道联系处理。

**继续使用即表示您已充分理解并同意承担上述所有风险。如有疑虑，请立即停止使用。**

## 许可证

本项目采用 [GNU通用公共许可证 v3 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html) 开源。

如果有帮到你，顺手点个star呗～

没帮到你也欢迎来issue区骂我，狠狠鞭策我～