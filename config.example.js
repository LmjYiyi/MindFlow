/**
 * MindFlow - API 配置模板文件
 * 
 * 使用方法：
 * 1. 复制此文件为 config.js
 * 2. 填入你的真实 API key
 * 3. 确保 config.js 已添加到 .gitignore
 */

// Google Gemini API 配置
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';

// 导出配置（供 background.js 使用）
if (typeof window === 'undefined') {
  // Service Worker 环境
  self.GEMINI_API_KEY = GEMINI_API_KEY;
  self.GEMINI_MODEL = GEMINI_MODEL;
}

