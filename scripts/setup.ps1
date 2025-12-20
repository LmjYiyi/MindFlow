# MindFlow 安装脚本 (PowerShell)
# 用于下载 p5.js 库和生成临时图标

Write-Host "🧘 MindFlow 安装脚本" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 获取脚本所在目录的父目录（项目根目录）
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# 1. 下载 p5.js
Write-Host "`n📦 正在下载 p5.js 库..." -ForegroundColor Yellow

$LibDir = Join-Path $ProjectRoot "lib"
$P5Path = Join-Path $LibDir "p5.min.js"

if (Test-Path $P5Path) {
    Write-Host "   p5.js 已存在，跳过下载" -ForegroundColor Green
} else {
    try {
        $P5Url = "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"
        Invoke-WebRequest -Uri $P5Url -OutFile $P5Path
        Write-Host "   ✓ p5.js 下载完成" -ForegroundColor Green
    } catch {
        Write-Host "   ✗ 下载失败，请手动下载 p5.js" -ForegroundColor Red
        Write-Host "   下载地址: https://p5js.org/download/" -ForegroundColor Gray
    }
}

# 2. 生成临时图标 (使用内联 Base64 PNG)
Write-Host "`n🎨 正在生成临时图标..." -ForegroundColor Yellow

$IconsDir = Join-Path $ProjectRoot "icons"

# 简单的蓝色圆形图标 (Base64 编码的 PNG)
# 16x16 图标
$Icon16Base64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA0UlEQVQ4T6WTwQ3CMAyGfzsdgBFgBEZgBEZgBBiBERiBERiBEegGrFCSyhVJG0pO9uv/7DhxYOUTVu7XOwAHkq8yiGRHsp/H8N4DOAC4VkBNIXks+QR2JG/VZpLbHLBOhQHAieSjAuy9N6DPJKKfkoEBeS4Bs3sJmN0vQO1+AWr3G9DYLUBj9wJIu7cCuN09gPq9C/AqzAC8CgD0uwngVwB2X4FXYAagX5H0cROA7uMmAN3HTQATewsw+CrMALwKGdDYLUBtP4Bq9xbAy/cfeAN1i0wRdz0KEQAAAABJRU5ErkJggg=="

# 48x48 图标
$Icon48Base64 = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABTklEQVRoQ+2Y0Q2CMBCG/zvQDRzBERzBERzBERzBERzBERzBDdxAPaMJaSi0lAPu/eRFHn/+67WlDRL/JXH9uAdQuwN3AF6yB0jeAExVOUnuABwAjDLs+wGcGmQmeY4h0wMYAxgBOLdBl4CZ5LLtoiQ/3RXojwHMASxyQEN8TvKQQn67u0gyeNsGhwBGJGf+vqwB6A3ArwB/AJI8ktyYWqT8TvLaPqJ1gElmF4mKJN8AHj1Oc0MH4Elyk0Bk0AF4kdyYFMl9oJMB6hQKIpIBBFqG/0ZSFpFMoSFJmUQBRDKFhiRlEgUQahnuJElyE3YByRQKIpIBBFqGpUnJFBqSlEkUQCRTaEhSJlEAkS6h0CRlEgUQ6RQKqZJMoQCiIKIsrxiR9AqFJimTKIBIptCQpEyiACIZQKBl+G9EyisUmiT5CtVNyk/y/wXwB68bUDGbiucjAAAAAElFTkSuQmCC"

# 128x128 图标
$Icon128Base64 = "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAC4klEQVR4nO3dS47bMBAE0M4xc/9bOYfJIoYHo0mRTUld5K8FGJb1qsguWR4nSZIkSZIkSZIkSZIkPdUt9QL0bLfUC9CzDxPAJfE69CDT8d8TeX9wSTIeAPjuJuWCS5Jx/veH7u7v8Ac4pV5AaU6Jx/0dwLKndxS65gPAkqQ8AGQAf0mSHoAC/hd/TP6+xNdM0AIE4AFIM37+z+pv//aP7y9weIpf/OP3+7k9fz7l9+eeS34NiVp6AH6XdvxvZycACMD3UicACMC5+roA7LhH4EcB+F7aDkCJlwQQP/63Mn4nAGme/1vFvhKAJE//LeO/E4AkT/8t41fvCnhO4ocPJPz8/5/+q/c0xI/Pb/iFhJ/dMv9bgON/i/gVhw4E4PukT0DxAIy1pJMhfidwiZ8JQMZzhj8IwEpLOxnidxKX+JsArHXpk0F+pyMBaHRdABxflwBw1O8E/hMAvxG4xC/eEHg/2PJOyJZMAtD8uvyJYNMD8N8QXOOPZ0u9gCacLPYaJoFrYHDOGSyA/4pwxJ4EhukSf4v4EThpWwCGawYAdYQAtPpSj/gt4m95L8A/7sWuS+IF8G/hB9+Q7D9H0OnmTwSLa9MngtWJAJS9OgAe4V8C17b5s0Db7C8E0Ab+gO1f/E7Am7X5K4F6AHzm3wlAqe8EoNFxAai6KgClr02AQcffpXh03L/tBXDoXg6ACu8EoOb1AfD9TgBCfr/lxzP9TgBivr/dh7PxOx2/T4EAhMz/Tf3UfxeApt8JQFL+7yLG/k5Hrv8i0H+1+YuBTQCL+u3EBxq4VlwDH5D/M0r//wQw/yEfEkxKAAAAABJRU5ErkJggg=="

function Save-Base64Image {
    param(
        [string]$Base64String,
        [string]$FilePath
    )
    
    if (-not (Test-Path $FilePath)) {
        $Bytes = [Convert]::FromBase64String($Base64String)
        [IO.File]::WriteAllBytes($FilePath, $Bytes)
        Write-Host "   ✓ 已生成 $(Split-Path -Leaf $FilePath)" -ForegroundColor Green
    } else {
        Write-Host "   $(Split-Path -Leaf $FilePath) 已存在，跳过" -ForegroundColor Gray
    }
}

Save-Base64Image -Base64String $Icon16Base64 -FilePath (Join-Path $IconsDir "icon16.png")
Save-Base64Image -Base64String $Icon48Base64 -FilePath (Join-Path $IconsDir "icon48.png")
Save-Base64Image -Base64String $Icon128Base64 -FilePath (Join-Path $IconsDir "icon128.png")

# 3. 完成提示
Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "✓ 安装完成！" -ForegroundColor Green
Write-Host "`n后续步骤:" -ForegroundColor Yellow
Write-Host "1. 打开 Chrome 浏览器"
Write-Host "2. 访问 chrome://extensions/"
Write-Host "3. 开启「开发者模式」"
Write-Host "4. 点击「加载已解压的扩展程序」"
Write-Host "5. 选择项目文件夹: $ProjectRoot"
Write-Host ""

