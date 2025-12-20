# 📦 第三方库

## p5.js

本插件使用 p5.js 进行 Level 3 视觉疗愈动画渲染。

### 下载方式

1. 访问 [p5.js 官方下载页](https://p5js.org/download/)
2. 下载 **p5.min.js** (压缩版)
3. 将文件放入此目录

或使用命令行：

```bash
# 使用 curl
curl -o lib/p5.min.js https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js

# 或使用 wget
wget -O lib/p5.min.js https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js
```

### 目录结构

```
lib/
├── p5.min.js    # p5.js 压缩版 (需下载)
└── README.md    # 本说明文件
```

### 版本要求

- 推荐版本：1.9.0 或更高
- 最低版本：1.4.0

### 注意事项

- 本项目使用 p5.js 的 **Instance Mode**，以避免全局作用域污染
- 库文件已在 `manifest.json` 中配置为 `web_accessible_resources`

