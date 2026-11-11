## 安装 · Install

1. 下载下面的 **DeskPiggy-macOS.zip**，解压，把 **Desk Piggy.app** 拖进「应用程序」。
2. 这个 App 没有 Apple 开发者签名，第一次打开会被拦下。到 **系统设置 → 隐私与安全性**，在页面底部点 **仍要打开**；或者在终端执行：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Desk Piggy.app"
   ```

3. 打开后小猪会出现在桌面上，菜单栏会多一个 🐷。

Download **DeskPiggy-macOS.zip**, unzip it and drag **Desk Piggy.app** to Applications. The app is not notarised, so the first launch is blocked: open **System Settings → Privacy & Security** and choose **Open Anyway**, or run the command above. Requires macOS 13 or later (Apple silicon and Intel).
