# 🎨 图标文件

本目录存放插件图标文件。

## 需要的图标

| 文件名 | 尺寸 | 用途 |
|--------|------|------|
| `icon16.png` | 16×16 | 浏览器工具栏图标 |
| `icon48.png` | 48×48 | 扩展管理页面图标 |
| `icon128.png` | 128×128 | Chrome 网上应用店图标 |

## 设计建议

- 使用简洁的图形，避免过多细节
- 主题色建议使用舒缓的蓝绿色调 (#64b5f6, #81c784)
- 透明背景 PNG 格式
- 可以使用波浪、呼吸、流动等元素体现「放松」主题

## 临时方案

在没有正式图标前，可以使用简单的纯色图标进行测试。

### 使用 ImageMagick 生成临时图标

```bash
# 生成蓝色圆形图标
convert -size 16x16 xc:transparent -fill "#64b5f6" -draw "circle 8,8 8,1" icon16.png
convert -size 48x48 xc:transparent -fill "#64b5f6" -draw "circle 24,24 24,4" icon48.png
convert -size 128x128 xc:transparent -fill "#64b5f6" -draw "circle 64,64 64,10" icon128.png
```

### 在线工具

- [Favicon.io](https://favicon.io/) - 在线图标生成器
- [Real Favicon Generator](https://realfavicongenerator.net/) - 多尺寸图标生成

