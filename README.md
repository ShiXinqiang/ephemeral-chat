# 🛡️ Ephemeral Secure Chat (临时安全通讯)

![License](https://img.shields.io/badge/license-MIT-green)
![Deploy](https://img.shields.io/badge/Deploy-Railway-blueviolet)
![Tech](https://img.shields.io/badge/Tech-Node.js%20%7C%20Canvas%20%7C%20WebCrypto-blue)

一个主打 **“防查岗、防截图、防 DOM 抓取、零痕迹”** 的极客风军用级安全通讯 Web 应用。

本系统旨在为高度机密的文字交流提供一个绝对安全的临时通道。服务器仅作为握手信令中转，**无数据库、无日志、无持久化存储**。所有数据均在内存中运行，阅后即焚，服务器重启即彻底物理级抹除。

## ✨ 核心硬核特性 (Features)

*   **🔒 军用级端到端加密 (E2EE):** 采用浏览器原生 `Web Crypto API (AES-GCM 256)`。每次创建房间动态生成密钥，服务器仅转发二进制乱码，绝对无法解密聊天内容。
*   **👁️ 反 DOM 抓取引擎 (Canvas Rendering):** 放弃传统的 HTML `<div>` 文本渲染。所有聊天记录均通过 JavaScript 像“画画”一样实时绘制在 `<canvas>` 画布上。市面上 99% 的恶意浏览器插件、翻译脚本、黑客抓包工具均无法读取聊天内容。
*   **🚨 硬件级防查岗 (Panic Shield):** 监听浏览器焦点事件。一旦用户按下 `Alt+Tab`、切换标签页或失去焦点，网页瞬间黑屏并伪装成 `SYSTEM ERROR`。
*   **📸 动态追踪水印 (Anti-Screenshot):** 画布底层铺满当前浏览者的强制备注名（Alias）。一旦遭到手机拍照或截屏泄露，立即暴露内鬼身份。
*   **⏳ 内存级时间胶囊 (Time Capsule):** 无需依赖数据库定时清理。前端利用 JavaScript `setInterval` 内存循环，精确到秒剔除过期消息，配合垃圾回收机制 (GC)，从物理内存层面做到真正的阅后即焚。
*   **👑 强制审查与身份继承:** 访客必须通过 8 位随机密码 + 房主强制设置备注才能进入通道。房主若退出，房间彻底销毁（或根据设置由顺位第二人继承）。

## 🚀 一键部署 (Deploy)

本项目无需任何数据库，极其轻量，完美适配 [Railway](https://railway.app/)、Vercel、Render 等免费 Serverless 或 Node.js 托管平台。

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

**本地运行测试:**
```bash
# 1. 克隆项目
git clone https://github.com/ShiXinqiang/ephemeral-chat.git

# 2. 进入目录并安装依赖
cd ephemeral-chat
npm install

# 3. 启动信令服务器
npm start

# 4. 浏览器访问 http://localhost:3000
