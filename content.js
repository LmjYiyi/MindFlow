/**
 * MindFlow - Content Script
 * 负责：
 * 1. 行为感知：监听滚动速度和点击频率
 * 2. 干预执行：接收 background.js 指令并执行三级干预
 * 3. p5.js 渲染：Level 3 视觉疗愈动画
 */

(function() {
  'use strict';
  
  // 防止重复注入
  if (window.__MINDFLOW_INJECTED__) {
    return;
  }
  window.__MINDFLOW_INJECTED__ = true;
  
  console.log('[MindFlow] Content script 已加载');
  
  // ============================================
  // 常量配置
  // ============================================
  
  const CONFIG = {
    // 行为采样配置
    BEHAVIOR_SAMPLE_INTERVAL: 100,    // 采样间隔 (ms)
    BEHAVIOR_REPORT_INTERVAL: 500,    // 上报间隔 (ms)
    
    // 滚动检测
    SCROLL_WINDOW_SIZE: 500,          // 滚动速度计算窗口 (ms)
    
    // 点击检测
    CLICK_WINDOW_SIZE: 1000,          // 点击频率计算窗口 (ms)
    
    // 视觉疗愈持续时间
    THERAPY_DURATION: 5000,           // 5秒
    
    // 阅读模式配置
    READER_MODE_WIDTH: '800px',
    READER_MODE_PADDING: '40px',
  };
  
  // ============================================
  // 行为感知模块 (Monitoring)
  // ============================================
  
  class BehaviorMonitor {
    constructor() {
      /** @type {Array<{time: number, position: number}>} */
      this.scrollEvents = [];
      
      /** @type {Array<number>} 点击时间戳数组 */
      this.clickEvents = [];
      
      this.lastScrollPosition = window.scrollY;
      this.lastScrollTime = Date.now();
      
      this.init();
    }
    
    init() {
      // 监听滚动事件
      window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
      
      // 监听点击事件
      document.addEventListener('click', this.handleClick.bind(this), { passive: true });
      
      // 定期上报行为数据
      setInterval(() => this.reportBehavior(), CONFIG.BEHAVIOR_REPORT_INTERVAL);
      
      console.log('[Monitor] 行为监听已启动');
    }
    
    /**
     * 处理滚动事件
     */
    handleScroll() {
      const now = Date.now();
      const currentPosition = window.scrollY;
      
      // 记录滚动事件
      this.scrollEvents.push({
        time: now,
        position: currentPosition
      });
      
      // 清理过期的滚动事件（保留最近窗口内的数据）
      const cutoffTime = now - CONFIG.SCROLL_WINDOW_SIZE;
      this.scrollEvents = this.scrollEvents.filter(e => e.time > cutoffTime);
    }
    
    /**
     * 处理点击事件
     */
    handleClick() {
      const now = Date.now();
      
      // 记录点击时间戳
      this.clickEvents.push(now);
      
      // 清理过期的点击事件
      const cutoffTime = now - CONFIG.CLICK_WINDOW_SIZE;
      this.clickEvents = this.clickEvents.filter(t => t > cutoffTime);
    }
    
    /**
     * 计算当前滚动速度 (px/s)
     * @returns {number}
     */
    calculateScrollSpeed() {
      if (this.scrollEvents.length < 2) {
        return 0;
      }
      
      const events = this.scrollEvents;
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];
      
      const timeDelta = (lastEvent.time - firstEvent.time) / 1000; // 转换为秒
      if (timeDelta <= 0) {
        return 0;
      }
      
      // 计算总滚动距离（使用绝对值处理上下滚动）
      let totalDistance = 0;
      for (let i = 1; i < events.length; i++) {
        totalDistance += Math.abs(events[i].position - events[i - 1].position);
      }
      
      return totalDistance / timeDelta;
    }
    
    /**
     * 计算当前点击频率 (次/s)
     * @returns {number}
     */
    calculateClickFrequency() {
      // 计算窗口内的点击次数，转换为每秒频率
      return this.clickEvents.length / (CONFIG.CLICK_WINDOW_SIZE / 1000);
    }
    
    /**
     * 上报行为数据到 background.js
     */
    reportBehavior() {
      const scrollSpeed = this.calculateScrollSpeed();
      const clickFrequency = this.calculateClickFrequency();
      
      // 只在有意义的数据时上报
      if (scrollSpeed > 0 || clickFrequency > 0) {
        try {
          chrome.runtime.sendMessage({
            type: 'BEHAVIOR_DATA',
            payload: {
              scrollSpeed: scrollSpeed,
              clickFrequency: clickFrequency,
              timestamp: Date.now()
            }
          }).catch(() => {
            // Service Worker 可能未就绪，静默忽略
          });
        } catch (e) {
          // 扩展上下文可能无效，静默忽略
        }
      }
    }
  }
  
  // ============================================
  // 干预执行模块 (Intervention)
  // ============================================
  
  class InterventionManager {
    constructor() {
      this.currentLevel = 0;
      this.softModeActive = false;
      this.readerModeActive = false;
      this.therapyActive = false;
      
      /** @type {HTMLElement|null} */
      this.readerOverlay = null;
      
      /** @type {HTMLElement|null} */
      this.therapyContainer = null;
      
      /** @type {HTMLElement|null} */
      this.suggestionToast = null;
      
      /** @type {p5|null} */
      this.p5Instance = null;
      
      this.init();
    }
    
    init() {
      // 监听来自 background.js 的消息
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'INTERVENTION') {
          this.handleIntervention(message.payload);
          sendResponse({ success: true });
        }
        // 渐进式建议提示（尊重用户控制权）
        else if (message.type === 'SUGGESTION') {
          this.showSuggestion(message.payload);
          sendResponse({ success: true });
        }
        return true;
      });
      
      console.log('[Intervention] 干预管理器已初始化');
    }
    
    /**
     * 显示渐进式建议提示（不强制干预）
     * 基于自我决定论，把选择权还给用户
     */
    showSuggestion(payload) {
      const { dsi, suggestionType } = payload;
      
      // 移除已有提示
      if (this.suggestionToast) {
        this.suggestionToast.remove();
      }
      
      this.suggestionToast = document.createElement('div');
      this.suggestionToast.className = `mindflow-suggestion-toast mindflow-suggestion-${suggestionType}`;
      
      const isStrong = suggestionType === 'strong';
      
      this.suggestionToast.innerHTML = `
        <div class="mindflow-suggestion-icon">${isStrong ? '🌿' : '🍃'}</div>
        <div class="mindflow-suggestion-content">
          <div class="mindflow-suggestion-title">
            ${isStrong ? '检测到页面杂乱' : '休息一下？'}
          </div>
          <div class="mindflow-suggestion-text">
            ${isStrong 
              ? '开启纯净阅读模式，让阅读更舒适？' 
              : '当前压力指数较高，可以考虑开启护眼模式'}
          </div>
        </div>
        <div class="mindflow-suggestion-actions">
          <button class="mindflow-suggestion-btn mindflow-suggestion-accept">
            ${isStrong ? '开启阅读模式' : '好的'}
          </button>
          <button class="mindflow-suggestion-btn mindflow-suggestion-dismiss">
            稍后
          </button>
        </div>
      `;
      
      document.body.appendChild(this.suggestionToast);
      
      // 绑定事件
      this.suggestionToast.querySelector('.mindflow-suggestion-accept').addEventListener('click', () => {
        if (isStrong) {
          this.activateReaderMode();
        }
        this.dismissSuggestion();
      });
      
      this.suggestionToast.querySelector('.mindflow-suggestion-dismiss').addEventListener('click', () => {
        this.dismissSuggestion();
      });
      
      // 10秒后自动消失
      setTimeout(() => this.dismissSuggestion(), 10000);
    }
    
    dismissSuggestion() {
      if (this.suggestionToast) {
        this.suggestionToast.classList.add('mindflow-suggestion-hiding');
        setTimeout(() => {
          this.suggestionToast?.remove();
          this.suggestionToast = null;
        }, 300);
      }
    }
    
    /**
     * 处理干预指令
     * 所有干预都先询问用户（基于自我决定论）
     * @param {Object} payload - {level, dsi, suggestion, entropyScore, isInFlowZone}
     */
    handleIntervention(payload) {
      const { level, dsi, entropyScore, isInFlowZone } = payload;
      console.log(`[Intervention] 收到干预指令: Level ${level}, DSI: ${dsi.toFixed(1)}, 熵: ${entropyScore?.toFixed(2) || 'N/A'}, 心流区: ${isInFlowZone}`);
      
      // 先清除低级别的干预
      if (level < this.currentLevel) {
        this.clearHigherInterventions(level);
        this.currentLevel = level;
        return;
      }
      
      // Level 0 直接执行
      if (level === 0) {
        this.deactivateAll();
        this.currentLevel = 0;
        return;
      }
      
      // 只有级别上升时才询问
      if (level > this.currentLevel) {
        this.askUserForIntervention(level, dsi);
      }
    }
    
    /**
     * 询问用户是否接受干预（尊重用户控制权）
     */
    askUserForIntervention(level, dsi) {
      // 如果已经有询问框，不重复弹出
      if (document.getElementById('mindflow-intervention-ask')) {
        return;
      }
      
      const levelInfo = {
        1: {
          icon: '🌙',
          title: '开启护眼模式？',
          desc: '检测到持续浏览，建议开启柔和护眼效果，降低视觉疲劳',
          action: '开启护眼'
        },
        2: {
          icon: '📖',
          title: '开启阅读模式？',
          desc: '当前页面信息较多，建议开启纯净阅读模式，减少干扰',
          action: '开启阅读'
        },
        3: {
          icon: '🧘',
          title: '需要休息一下吗？',
          desc: '检测到您可能有些疲劳，建议进行 30 秒呼吸放松',
          action: '开始放松'
        }
      };
      
      const info = levelInfo[level];
      if (!info) return;
      
      const askDialog = document.createElement('div');
      askDialog.id = 'mindflow-intervention-ask';
      askDialog.className = 'mindflow-intervention-ask';
      askDialog.innerHTML = `
        <div class="mindflow-ask-card">
          <div class="mindflow-ask-icon">${info.icon}</div>
          <div class="mindflow-ask-content">
            <div class="mindflow-ask-title">${info.title}</div>
            <div class="mindflow-ask-desc">${info.desc}</div>
            <div class="mindflow-ask-dsi">当前压力指数: ${Math.round(dsi)}</div>
          </div>
          <div class="mindflow-ask-actions">
            <button class="mindflow-ask-btn mindflow-ask-accept">${info.action}</button>
            <button class="mindflow-ask-btn mindflow-ask-later">稍后提醒</button>
            <button class="mindflow-ask-btn mindflow-ask-dismiss">不需要</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(askDialog);
      
      // 绑定事件
      askDialog.querySelector('.mindflow-ask-accept').addEventListener('click', () => {
        this.executeIntervention(level);
        askDialog.remove();
      });
      
      askDialog.querySelector('.mindflow-ask-later').addEventListener('click', () => {
        askDialog.remove();
        // 10秒后再次提醒
        setTimeout(() => {
          if (this.currentLevel < level) {
            this.askUserForIntervention(level, dsi);
          }
        }, 10000);
      });
      
      askDialog.querySelector('.mindflow-ask-dismiss').addEventListener('click', () => {
        askDialog.remove();
        // 用户明确拒绝，记录并在一段时间内不再提醒
        this.dismissedLevel = level;
        setTimeout(() => {
          this.dismissedLevel = 0;
        }, 60000);  // 60秒后重置
      });
      
      // 20秒后自动消失
      setTimeout(() => {
        if (document.getElementById('mindflow-intervention-ask')) {
          askDialog.remove();
        }
      }, 20000);
    }
    
    /**
     * 执行干预
     */
    executeIntervention(level) {
      this.currentLevel = level;
      
      switch (level) {
        case 1:
          this.activateSoftMode();
          break;
        case 2:
          this.activateSoftMode();
          this.activateReaderMode();
          break;
        case 3:
          this.activateSoftMode();
          this.activateVisualTherapy();
          break;
      }
    }
    
    /**
     * 清除高于指定级别的干预
     * @param {number} targetLevel
     */
    clearHigherInterventions(targetLevel) {
      if (targetLevel < 3 && this.therapyActive) {
        this.deactivateVisualTherapy();
      }
      if (targetLevel < 2 && this.readerModeActive) {
        this.deactivateReaderMode();
      }
      if (targetLevel < 1 && this.softModeActive) {
        this.deactivateSoftMode();
      }
    }
    
    /**
     * 停用所有干预
     */
    deactivateAll() {
      this.deactivateSoftMode();
      this.deactivateReaderMode();
      this.deactivateVisualTherapy();
    }
    
    // ============================================
    // Level 1: 柔和模式 (Soft Mode)
    // ============================================
    
    /**
     * 激活柔和模式 - 调整页面色彩护眼
     */
    activateSoftMode() {
      if (this.softModeActive) return;
      
      document.body.classList.add('mindflow-soft-mode');
      this.softModeActive = true;
      console.log('[Level 1] 柔和模式已激活');
    }
    
    deactivateSoftMode() {
      document.body.classList.remove('mindflow-soft-mode');
      this.softModeActive = false;
    }
    
    // ============================================
    // Level 2: 阅读模式 (Reader Mode)
    // ============================================
    
    /**
     * 激活阅读模式 - 提取正文并显示纯净内容
     */
    activateReaderMode() {
      if (this.readerModeActive) return;
      
      // 提取页面正文（模拟 Readability）
      const articleContent = this.extractContent();
      
      if (!articleContent) {
        console.log('[Level 2] 无法提取正文内容');
        return;
      }
      
      // 创建阅读模式覆盖层
      this.readerOverlay = document.createElement('div');
      this.readerOverlay.id = 'mindflow-reader-overlay';
      this.readerOverlay.className = 'mindflow-reader-overlay';
      
      // 构建阅读模式内容（优化布局）
      this.readerOverlay.innerHTML = `
        <div class="mindflow-reader-container">
          <div class="mindflow-reader-header">
            <h1 class="mindflow-reader-title">${this.escapeHtml(articleContent.title)}</h1>
            <button class="mindflow-reader-close" id="mindflow-close-reader" title="关闭阅读模式">✕</button>
          </div>
          
          <div id="mindflow-summary-container" class="mindflow-summary-container">
            <div class="mindflow-summary-header">
              <span class="mindflow-summary-icon">🤖</span>
              <span class="mindflow-summary-title">AI 智能摘要</span>
              <span class="mindflow-summary-badge">DeepSeek</span>
            </div>
            <div id="mindflow-summary-content" class="mindflow-summary-content">
              <div class="mindflow-summary-loading">
                <span class="mindflow-loading-spinner"></span>
                <span>正在分析文章内容，生成智能摘要...</span>
              </div>
            </div>
          </div>
          
          <article class="mindflow-reader-content">
            ${articleContent.content}
          </article>
        </div>
      `;
      
      document.body.appendChild(this.readerOverlay);
      
      // 绑定关闭按钮事件
      const closeButton = document.getElementById('mindflow-close-reader');
      if (closeButton) {
        closeButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.deactivateReaderMode();
        });
      }
      
      this.readerModeActive = true;
      console.log('[Level 2] 阅读模式已激活');
      
      // 自动生成 AI 摘要
      setTimeout(() => {
        this.generateAISummary(articleContent.textContent);
      }, 500);
    }
    
    /**
     * HTML 转义，防止 XSS
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    deactivateReaderMode() {
      if (this.readerOverlay) {
        this.readerOverlay.remove();
        this.readerOverlay = null;
      }
      this.readerModeActive = false;
    }
    
    /**
     * 模拟 Readability 提取页面正文内容
     * @returns {{title: string, content: string, textContent: string}|null}
     */
    extractContent() {
      // 这里模拟 @mozilla/readability 的提取逻辑
      // 实际项目中应导入 Readability 库
      
      try {
        // 获取标题
        const title = document.querySelector('h1')?.textContent 
          || document.querySelector('title')?.textContent 
          || '未知标题';
        
        // 尝试找到主要内容区域
        const contentSelectors = [
          'article',
          '[role="main"]',
          'main',
          '.post-content',
          '.article-content',
          '.entry-content',
          '.content',
          '#content'
        ];
        
        let contentElement = null;
        for (const selector of contentSelectors) {
          contentElement = document.querySelector(selector);
          if (contentElement) break;
        }
        
        // 如果找不到特定内容区域，使用 body
        if (!contentElement) {
          contentElement = document.body;
        }
        
        // 克隆内容以避免修改原页面
        const clonedContent = contentElement.cloneNode(true);
        
        // 移除不需要的元素
        const removeSelectors = [
          'script', 'style', 'nav', 'header', 'footer',
          'aside', '.sidebar', '.ad', '.advertisement',
          '.social-share', '.comments', 'iframe'
        ];
        
        removeSelectors.forEach(selector => {
          clonedContent.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        const content = clonedContent.innerHTML;
        const textContent = clonedContent.textContent || '';
        
        return {
          title: title.trim(),
          content: content,
          textContent: textContent.trim().slice(0, 5000) // 限制长度用于 AI 摘要
        };
        
      } catch (error) {
        console.error('[Reader] 内容提取失败:', error);
        return null;
      }
    }
    
    /**
     * 调用 DeepSeek API 生成摘要
     * @param {string} textContent - 文章正文
     */
    async generateAISummary(textContent) {
      const summaryContent = document.getElementById('mindflow-summary-content');
      
      if (!summaryContent) return;
      
      try {
        // 使用 DeepSeek API（预配置）
        const apiKey = 'sk-6fd786ed95a740d692709eb73fd049c5';
        const apiEndpoint = 'https://api.deepseek.com/v1/chat/completions';
        
        // 限制文本长度，避免超过 token 限制
        const truncatedText = textContent.slice(0, 3000);
        
        console.log('[AI Summary] 开始调用 DeepSeek API...');
        
        // 调用 DeepSeek API
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: '你是一个专业的文章摘要助手。请用简洁优雅的中文为用户生成文章的核心要点摘要。要求：1. 提炼3-5个关键观点；2. 每个观点用一句话概括；3. 使用emoji增强可读性；4. 总字数控制在200字以内。'
              },
              {
                role: 'user',
                content: `请为以下文章生成摘要：\n\n${truncatedText}`
              }
            ],
            max_tokens: 500,
            temperature: 0.7,
            stream: false
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`API 请求失败 (${response.status}): ${errorData.error?.message || '未知错误'}`);
        }
        
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content || '无法生成摘要';
        
        console.log('[AI Summary] 摘要生成成功');
        
        // 格式化摘要内容
        const formattedSummary = this.formatSummary(summary);
        summaryContent.innerHTML = formattedSummary;
        
      } catch (error) {
        console.error('[AI Summary] 生成失败:', error);
        summaryContent.innerHTML = `
          <div class="mindflow-summary-error">
            <div class="mindflow-error-icon">⚠️</div>
            <div class="mindflow-error-title">摘要生成失败</div>
            <div class="mindflow-error-message">${this.escapeHtml(error.message)}</div>
            <div class="mindflow-error-tip">提示：请检查网络连接或稍后重试</div>
          </div>
        `;
      }
    }
    
    /**
     * 格式化 AI 摘要内容，使其更易读
     */
    formatSummary(summary) {
      // 将摘要按行分割，添加样式
      const lines = summary.trim().split('\n').filter(line => line.trim());
      
      let formatted = '<div class="mindflow-summary-text">';
      
      lines.forEach(line => {
        line = line.trim();
        // 如果是数字开头或包含emoji的要点
        if (/^[\d\-\*•]/.test(line) || /[\u{1F300}-\u{1F9FF}]/u.test(line)) {
          formatted += `<div class="mindflow-summary-point">${this.escapeHtml(line)}</div>`;
        } else {
          formatted += `<p>${this.escapeHtml(line)}</p>`;
        }
      });
      
      formatted += '</div>';
      
      return formatted;
    }
    
    // ============================================
    // Level 3: 视觉疗愈 (Visual Therapy)
    // 基于 Coherent Breathing (同频呼吸) 理论
    // 呼吸频率锁定在 0.1Hz (每分钟6次)
    // 4-6 呼吸法：吸气4秒，呼气6秒
    // ============================================
    
    /**
     * 激活视觉疗愈 - 全屏 p5.js 舒缓动画
     * 添加"我真的很急"紧急跳过按钮（尊重用户控制权）
     */
    activateVisualTherapy() {
      if (this.therapyActive) return;
      
      // 创建全屏容器
      this.therapyContainer = document.createElement('div');
      this.therapyContainer.id = 'mindflow-therapy-container';
      this.therapyContainer.className = 'mindflow-therapy-container';
      
      // 添加顶部呼吸引导（不会与圆环重叠）
      const topGuide = document.createElement('div');
      topGuide.className = 'mindflow-therapy-top-guide';
      topGuide.innerHTML = `
        <div class="mindflow-breath-text" id="mindflow-breath-text">吸气...</div>
        <div class="mindflow-breath-timer" id="mindflow-breath-timer">4</div>
      `;
      this.therapyContainer.appendChild(topGuide);
      
      // 添加底部控制区域
      const bottomControl = document.createElement('div');
      bottomControl.className = 'mindflow-therapy-bottom-control';
      bottomControl.innerHTML = `
        <p class="mindflow-therapy-subtitle">跟随圆环节奏，调整呼吸</p>
        <p class="mindflow-therapy-countdown" id="mindflow-therapy-countdown">30 秒后自动关闭</p>
        <button class="mindflow-therapy-skip" id="mindflow-therapy-skip" title="我真的很急">
          跳过
        </button>
      `;
      this.therapyContainer.appendChild(bottomControl);
      
      document.body.appendChild(this.therapyContainer);
      
      // 绑定跳过按钮（尊重用户控制权）
      document.getElementById('mindflow-therapy-skip')?.addEventListener('click', () => {
        console.log('[Level 3] 用户选择跳过视觉疗愈');
        this.deactivateVisualTherapy();
      });
      
      // 初始化 p5.js 实例（使用 Instance Mode，实现 4-6 呼吸法）
      this.initP5Instance();
      
      this.therapyActive = true;
      console.log('[Level 3] 视觉疗愈已激活（4-6 呼吸法）');
      
      // 倒计时显示（延长到 30 秒，完成 3 个完整呼吸周期）
      let countdown = 30;
      const countdownEl = document.getElementById('mindflow-therapy-countdown');
      const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) {
          countdownEl.textContent = `${countdown} 秒后自动关闭`;
        }
        if (countdown <= 0) {
          clearInterval(countdownInterval);
        }
      }, 1000);
      
      // 30秒后自动关闭（3个完整呼吸周期：10秒×3）
      this.therapyTimeout = setTimeout(() => {
        clearInterval(countdownInterval);
        this.deactivateVisualTherapy();
      }, 30000);
    }
    
    deactivateVisualTherapy() {
      // 清除定时器
      if (this.therapyTimeout) {
        clearTimeout(this.therapyTimeout);
        this.therapyTimeout = null;
      }
      
      // 销毁 p5.js 实例
      if (this.p5Instance) {
        this.p5Instance.remove();
        this.p5Instance = null;
      }
      
      // 移除容器
      if (this.therapyContainer) {
        this.therapyContainer.remove();
        this.therapyContainer = null;
      }
      
      this.therapyActive = false;
      console.log('[Level 3] 视觉疗愈已结束');
    }
    
    /**
     * 初始化 p5.js 实例 - 4-6 呼吸法同频呼吸动画
     * 
     * 基于 Coherent Breathing (同频呼吸) 理论：
     * - 呼吸频率锁定在 0.1 Hz (每分钟 6 次呼吸)
     * - 4-6 呼吸法：吸气 4 秒，呼气 6 秒
     * - 这是科学验证的能最大程度激活迷走神经的呼吸频率
     * 
     * 配色采用 莫兰迪自然疗愈色系 (Biophilic Design)
     */
    initP5Instance() {
      // 检查 p5.js 是否已加载
      if (typeof p5 === 'undefined') {
        console.error('[p5.js] 库未加载');
        return;
      }
      
      const container = this.therapyContainer;
      
      // p5.js Instance Mode 草图定义
      const sketch = (p) => {
        // 4-6 呼吸法参数
        const INHALE_DURATION = 4000;   // 吸气 4 秒
        const EXHALE_DURATION = 6000;   // 呼气 6 秒
        const BREATH_CYCLE = INHALE_DURATION + EXHALE_DURATION;  // 完整周期 10 秒
        
        let breathStartTime = 0;
        let isInhaling = true;
        
        // 粒子数组（减少数量，降低视觉噪音）
        let particles = [];
        const PARTICLE_COUNT = 60;
        
        // 莫兰迪自然疗愈色系 (Biophilic Design)
        const colors = [
          [45, 106, 79],    // 森林绿 #2D6A4F
          [149, 213, 178],  // 鼠尾草绿 #95D5B2
          [27, 67, 50],     // 深海蓝绿 #1B4332
          [64, 145, 108],   // 翠绿 #40916C
          [183, 228, 199]   // 薄荷绿 #B7E4C7
        ];
        
        /**
         * 粒子类 - 柔和的漂浮粒子
         */
        class Particle {
          constructor() {
            this.reset();
          }
          
          reset() {
            this.x = p.random(p.width);
            this.y = p.random(p.height);
            this.baseSize = p.random(2, 5);
            this.size = this.baseSize;
            this.color = colors[Math.floor(p.random(colors.length))];
            this.alpha = p.random(40, 100);
            this.noiseOffset = p.random(1000);
            this.speed = p.random(0.2, 0.5);
          }
          
          update(breathProgress) {
            // 柔和的 Perlin 噪声运动
            const noiseVal = p.noise(
              this.x * 0.003 + this.noiseOffset,
              this.y * 0.003,
              p.frameCount * 0.002
            );
            
            const angle = noiseVal * p.TWO_PI * 2;
            this.x += p.cos(angle) * this.speed;
            this.y += p.sin(angle) * this.speed;
            
            // 随呼吸节奏变化透明度和大小
            this.size = this.baseSize * (0.8 + breathProgress * 0.4);
            
            // 边界处理
            if (this.x < 0) this.x = p.width;
            if (this.x > p.width) this.x = 0;
            if (this.y < 0) this.y = p.height;
            if (this.y > p.height) this.y = 0;
          }
          
          draw() {
            p.noStroke();
            p.fill(this.color[0], this.color[1], this.color[2], this.alpha);
            p.ellipse(this.x, this.y, this.size, this.size);
          }
        }
        
        p.setup = function() {
          const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
          canvas.parent(container);
          
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(new Particle());
          }
          
          breathStartTime = p.millis();
          p.frameRate(60);
        };
        
        p.draw = function() {
          // 计算呼吸进度
          const elapsed = p.millis() - breathStartTime;
          const cycleTime = elapsed % BREATH_CYCLE;
          
          let breathProgress;
          let currentPhase;
          let phaseTime;
          
          if (cycleTime < INHALE_DURATION) {
            // 吸气阶段 (4秒)
            isInhaling = true;
            currentPhase = '吸气...';
            phaseTime = Math.ceil((INHALE_DURATION - cycleTime) / 1000);
            // 缓动曲线：慢-快-慢
            breathProgress = easeInOutSine(cycleTime / INHALE_DURATION);
          } else {
            // 呼气阶段 (6秒)
            isInhaling = false;
            currentPhase = '呼气...';
            const exhaleTime = cycleTime - INHALE_DURATION;
            phaseTime = Math.ceil((EXHALE_DURATION - exhaleTime) / 1000);
            // 缓动曲线：快-慢
            breathProgress = 1 - easeInOutSine(exhaleTime / EXHALE_DURATION);
          }
          
          // 更新呼吸提示文字
          updateBreathGuide(currentPhase, phaseTime);
          
          // 绘制自然渐变背景（莫兰迪色系）
          drawNaturalBackground();
          
          // 更新和绘制粒子
          for (const particle of particles) {
            particle.update(breathProgress);
            particle.draw();
          }
          
          // 绘制中心呼吸圆环（模拟肺部扩张收缩）
          drawBreathingRing(breathProgress);
        };
        
        /**
         * 缓动函数：正弦缓入缓出
         */
        function easeInOutSine(t) {
          return -(p.cos(p.PI * t) - 1) / 2;
        }
        
        /**
         * 更新呼吸引导文字
         */
        function updateBreathGuide(phase, time) {
          const textEl = document.getElementById('mindflow-breath-text');
          const timerEl = document.getElementById('mindflow-breath-timer');
          
          if (textEl) textEl.textContent = phase;
          if (timerEl) timerEl.textContent = time;
        }
        
        /**
         * 绘制自然渐变背景（莫兰迪森林色系）
         */
        function drawNaturalBackground() {
          // 深森林绿渐变
          const c1 = p.color(20, 40, 30);   // 深墨绿
          const c2 = p.color(30, 55, 45);   // 森林深处
          
          for (let y = 0; y < p.height; y++) {
            const inter = p.map(y, 0, p.height, 0, 1);
            const c = p.lerpColor(c1, c2, inter);
            p.stroke(c);
            p.line(0, y, p.width, y);
          }
        }
        
        /**
         * 绘制中心呼吸圆环（4-6 呼吸法核心视觉）
         * 模拟肺部扩张收缩
         */
        function drawBreathingRing(progress) {
          const centerX = p.width / 2;
          const centerY = p.height / 2;
          
          // 基于呼吸进度的半径变化
          const minRadius = 60;
          const maxRadius = 140;
          const currentRadius = minRadius + (maxRadius - minRadius) * progress;
          
          // 外层光晕（多层渐变）
          p.noStroke();
          for (let i = 6; i > 0; i--) {
            const r = currentRadius + i * 25;
            const alpha = p.map(i, 6, 0, 5, 30);
            p.fill(149, 213, 178, alpha);  // 鼠尾草绿光晕
            p.ellipse(centerX, centerY, r * 2, r * 2);
          }
          
          // 主圆环（莫兰迪绿）
          p.noFill();
          p.strokeWeight(8);
          p.stroke(149, 213, 178, 180);  // 鼠尾草绿
          p.ellipse(centerX, centerY, currentRadius * 2, currentRadius * 2);
          
          // 内圈
          p.strokeWeight(3);
          p.stroke(183, 228, 199, 150);  // 薄荷绿
          p.ellipse(centerX, centerY, currentRadius * 1.5, currentRadius * 1.5);
          
          // 中心点（呼吸焦点）
          p.noStroke();
          const coreAlpha = 100 + progress * 100;
          p.fill(149, 213, 178, coreAlpha);
          p.ellipse(centerX, centerY, 20 + progress * 10, 20 + progress * 10);
        }
        
        p.windowResized = function() {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };
      };
      
      // 创建 p5.js 实例
      this.p5Instance = new p5(sketch);
    }
  }
  
  // ============================================
  // 侧边栏面板 (Sidebar Panel)
  // ============================================
  
  class SidebarPanel {
    constructor() {
      this.panel = null;
      this.floatButton = null;
      this.isVisible = false;
      this.dsi = 0;
      this.level = 0;
      
      this.init();
    }
    
    init() {
      // 创建悬浮触发按钮（始终显示）
      this.createFloatButton();
      
      // 创建侧边栏面板
      this.createPanel();
      
      // 定期更新 DSI 显示
      setInterval(() => this.updateDSI(), 1000);
      
      // 监听键盘快捷键（Alt+M 切换面板）
      document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'm') {
          e.preventDefault();
          this.toggle();
        }
      });
    }
    
    /**
     * 创建悬浮触发按钮
     */
    createFloatButton() {
      this.floatButton = document.createElement('div');
      this.floatButton.id = 'mindflow-float-button';
      this.floatButton.className = 'mindflow-float-button';
      
      this.floatButton.innerHTML = `
        <div class="mindflow-float-inner">
          <div class="mindflow-float-icon">🧘</div>
          <div class="mindflow-float-dsi" id="mindflow-float-dsi">0</div>
          <div class="mindflow-float-ring" id="mindflow-float-ring"></div>
        </div>
        <div class="mindflow-float-tooltip">
          <span>MindFlow</span>
          <span class="mindflow-float-shortcut">Alt+M</span>
        </div>
      `;
      
      document.body.appendChild(this.floatButton);
      
      // 点击打开侧边栏
      this.floatButton.addEventListener('click', () => {
        this.toggle();
      });
      
      // 拖拽功能
      this.makeDraggable(this.floatButton);
    }
    
    /**
     * 使悬浮按钮可拖拽到任意位置（上下左右）
     */
    makeDraggable(element) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      
      element.addEventListener('mousedown', (e) => {
        if (e.target.closest('.mindflow-float-inner')) {
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          
          // 获取当前位置
          const rect = element.getBoundingClientRect();
          startLeft = rect.left;
          startTop = rect.top;
          
          element.style.transition = 'none';
          e.preventDefault();
        }
      });
      
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;
        
        // 限制在视口范围内
        const maxLeft = window.innerWidth - element.offsetWidth - 10;
        const maxTop = window.innerHeight - element.offsetHeight - 10;
        
        newLeft = Math.max(10, Math.min(maxLeft, newLeft));
        newTop = Math.max(10, Math.min(maxTop, newTop));
        
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';
        element.style.right = 'auto';
        element.style.bottom = 'auto';
      });
      
      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          element.style.transition = '';
          
          // 保存位置到 localStorage
          localStorage.setItem('mindflow-float-left', element.style.left);
          localStorage.setItem('mindflow-float-top', element.style.top);
        }
      });
      
      // 恢复上次位置
      const savedLeft = localStorage.getItem('mindflow-float-left');
      const savedTop = localStorage.getItem('mindflow-float-top');
      if (savedLeft && savedTop) {
        element.style.left = savedLeft;
        element.style.top = savedTop;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
      }
    }
    
    /**
     * 更新悬浮按钮显示
     */
    updateFloatButton() {
      const floatDsi = document.getElementById('mindflow-float-dsi');
      const floatRing = document.getElementById('mindflow-float-ring');
      
      if (floatDsi) {
        floatDsi.textContent = Math.round(this.dsi);
      }
      
      if (floatRing) {
        // 根据 DSI 值设置环形进度
        const progress = this.dsi / 100;
        const circumference = 2 * Math.PI * 26; // r=26
        const offset = circumference * (1 - progress);
        floatRing.style.setProperty('--progress-offset', offset);
        
        // 根据级别设置颜色
        const colors = ['#4CAF50', '#FFC107', '#FF9800', '#F44336'];
        floatRing.style.setProperty('--progress-color', colors[this.level]);
      }
      
      // 根据级别添加动画效果
      if (this.floatButton) {
        this.floatButton.className = `mindflow-float-button mindflow-float-level-${this.level}`;
      }
    }
    
    createPanel() {
      this.panel = document.createElement('div');
      this.panel.id = 'mindflow-sidebar';
      this.panel.className = 'mindflow-sidebar';
      
      this.panel.innerHTML = `
        <div class="mindflow-sidebar-header">
          <div class="mindflow-sidebar-logo">
            <span class="mindflow-logo-icon">🧘</span>
            <span class="mindflow-logo-text">MindFlow</span>
          </div>
          <button class="mindflow-sidebar-toggle" id="mindflow-sidebar-toggle" title="收起面板 (Alt+M)">×</button>
        </div>
        
        <div class="mindflow-sidebar-content">
          <!-- DSI 仪表盘：圆环进度条 + 大数字 -->
          <div class="mindflow-dsi-display">
            <div class="mindflow-dsi-label">数字压力指数</div>
            <div class="mindflow-dsi-ring-container">
              <svg class="mindflow-dsi-ring" viewBox="0 0 120 120">
                <circle class="mindflow-dsi-ring-bg" cx="60" cy="60" r="54" />
                <circle class="mindflow-dsi-ring-progress" id="mindflow-dsi-ring-progress" cx="60" cy="60" r="54" />
              </svg>
              <div class="mindflow-dsi-number" id="mindflow-dsi-value">0</div>
            </div>
            <div class="mindflow-dsi-status-badge" id="mindflow-dsi-status">😊 状态良好</div>
          </div>
          
          <!-- 干预级别：垂直时间轴 -->
          <div class="mindflow-level-indicator">
            <div class="mindflow-level-title">当前干预级别</div>
            <ul class="mindflow-level-list">
              <li class="mindflow-level-item" data-level="0" id="mindflow-level-0">
                <span class="mindflow-level-text">正常浏览</span>
              </li>
              <li class="mindflow-level-item" data-level="1" id="mindflow-level-1">
                <span class="mindflow-level-text">柔和模式</span>
              </li>
              <li class="mindflow-level-item" data-level="2" id="mindflow-level-2">
                <span class="mindflow-level-text">阅读模式</span>
              </li>
              <li class="mindflow-level-item" data-level="3" id="mindflow-level-3">
                <span class="mindflow-level-text">视觉疗愈</span>
              </li>
            </ul>
          </div>
          
          <!-- 信息卡片：可折叠 -->
          <div class="mindflow-info-card">
            <div class="mindflow-info-header" id="mindflow-info-toggle">
              <span class="mindflow-info-icon">💡</span>
              <span class="mindflow-info-title">DSI 如何变化？</span>
              <span class="mindflow-info-arrow">▼</span>
            </div>
            <div class="mindflow-info-content" id="mindflow-info-content">
              <div class="mindflow-info-row">
                <span class="mindflow-info-icon">📈</span>
                <span>快速滚动 (>1500px/s) → +5</span>
              </div>
              <div class="mindflow-info-row">
                <span class="mindflow-info-icon">🖱️</span>
                <span>高频点击 (>3次/s) → +8</span>
              </div>
              <div class="mindflow-info-row">
                <span class="mindflow-info-icon">⏱️</span>
                <span>持续浏览 → +0.5/秒</span>
              </div>
              <div class="mindflow-info-row">
                <span class="mindflow-info-icon">😴</span>
                <span>静止10秒后 → -2/秒</span>
              </div>
            </div>
          </div>
          
          <!-- 白噪音功能 -->
          <div class="mindflow-whitenoise-card">
            <div class="mindflow-whitenoise-header">
              <span class="mindflow-whitenoise-icon">🎵</span>
              <span class="mindflow-whitenoise-title">白噪音</span>
              <label class="mindflow-switch">
                <input type="checkbox" id="mindflow-whitenoise-toggle">
                <span class="mindflow-switch-slider"></span>
              </label>
            </div>
            <div class="mindflow-whitenoise-options" id="mindflow-whitenoise-options">
              <div class="mindflow-whitenoise-grid">
                <button class="mindflow-noise-btn" data-noise="rain" title="雨声">🌧️</button>
                <button class="mindflow-noise-btn" data-noise="forest" title="森林">🌲</button>
                <button class="mindflow-noise-btn" data-noise="ocean" title="海浪">🌊</button>
                <button class="mindflow-noise-btn" data-noise="fire" title="篝火">🔥</button>
                <button class="mindflow-noise-btn" data-noise="wind" title="微风">🍃</button>
                <button class="mindflow-noise-btn" data-noise="night" title="夜晚">🌙</button>
              </div>
              <div class="mindflow-volume-control">
                <span class="mindflow-volume-icon">🔈</span>
                <input type="range" id="mindflow-volume-slider" min="0" max="100" value="50">
                <span class="mindflow-volume-value" id="mindflow-volume-value">50%</span>
              </div>
            </div>
          </div>
          
          <div class="mindflow-actions">
            <button class="mindflow-btn mindflow-btn-reset" id="mindflow-reset-btn">
              <span>🔄</span>
              <span>重置 DSI</span>
            </button>
          </div>
        </div>
        
        <div class="mindflow-sidebar-footer">
          <div class="mindflow-shortcut-tip">快捷键: Alt+M</div>
        </div>
      `;
      
      document.body.appendChild(this.panel);
      
      // 绑定事件
      document.getElementById('mindflow-sidebar-toggle').addEventListener('click', () => {
        this.hide();
      });
      
      document.getElementById('mindflow-reset-btn').addEventListener('click', () => {
        this.resetDSI();
      });
      
      // 白噪音功能
      this.initWhiteNoise();
      
      // 信息卡片折叠功能
      const infoToggle = document.getElementById('mindflow-info-toggle');
      const infoContent = document.getElementById('mindflow-info-content');
      if (infoToggle && infoContent) {
        let isExpanded = false;
        infoToggle.addEventListener('click', () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            infoContent.style.maxHeight = infoContent.scrollHeight + 'px';
            infoContent.classList.add('active');
          } else {
            infoContent.style.maxHeight = '0';
            infoContent.classList.remove('active');
          }
          const arrow = infoToggle.querySelector('.mindflow-info-arrow');
          if (arrow) {
            arrow.textContent = isExpanded ? '▲' : '▼';
            arrow.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(0deg)';
          }
        });
        // 默认折叠
        infoContent.style.maxHeight = '0';
      }
      
      // 默认不显示面板（用户点击悬浮按钮打开）
    }
    
    /**
     * 初始化白噪音功能
     */
    initWhiteNoise() {
      this.audioContext = null;
      this.currentNoise = null;
      this.noiseGain = null;
      this.isNoisePlaying = false;
      
      const toggle = document.getElementById('mindflow-whitenoise-toggle');
      const options = document.getElementById('mindflow-whitenoise-options');
      const volumeSlider = document.getElementById('mindflow-volume-slider');
      const volumeValue = document.getElementById('mindflow-volume-value');
      const noiseButtons = document.querySelectorAll('.mindflow-noise-btn');
      
      // 开关白噪音
      toggle?.addEventListener('change', (e) => {
        if (e.target.checked) {
          options.classList.add('active');
          // 默认播放雨声
          if (!this.isNoisePlaying) {
            this.playWhiteNoise('rain');
            noiseButtons[0]?.classList.add('active');
          }
        } else {
          options.classList.remove('active');
          this.stopWhiteNoise();
          noiseButtons.forEach(btn => btn.classList.remove('active'));
        }
      });
      
      // 选择噪音类型
      noiseButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const noiseType = btn.dataset.noise;
          noiseButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.playWhiteNoise(noiseType);
          
          // 确保开关打开
          if (toggle) toggle.checked = true;
          options.classList.add('active');
        });
      });
      
      // 音量控制
      volumeSlider?.addEventListener('input', (e) => {
        const volume = e.target.value;
        volumeValue.textContent = `${volume}%`;
        this.setNoiseVolume(volume / 100);
      });
    }
    
    /**
     * 播放白噪音
     */
    playWhiteNoise(type) {
      // 停止当前播放
      this.stopWhiteNoise();
      
      // 创建音频上下文
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // 根据类型生成不同的噪音
      const bufferSize = 2 * this.audioContext.sampleRate;
      const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      
      // 生成噪音数据
      this.generateNoiseData(output, type);
      
      // 创建音频节点
      this.currentNoise = this.audioContext.createBufferSource();
      this.currentNoise.buffer = noiseBuffer;
      this.currentNoise.loop = true;
      
      // 创建增益节点（音量控制）
      this.noiseGain = this.audioContext.createGain();
      const volumeSlider = document.getElementById('mindflow-volume-slider');
      this.noiseGain.gain.value = (volumeSlider?.value || 50) / 100;
      
      // 添加低通滤波器使声音更柔和
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = this.getFilterFrequency(type);
      
      // 连接节点
      this.currentNoise.connect(filter);
      filter.connect(this.noiseGain);
      this.noiseGain.connect(this.audioContext.destination);
      
      // 开始播放
      this.currentNoise.start();
      this.isNoisePlaying = true;
      
      console.log(`[WhiteNoise] 播放 ${type} 白噪音`);
    }
    
    /**
     * 生成不同类型的噪音数据
     */
    generateNoiseData(output, type) {
      const len = output.length;
      
      switch (type) {
        case 'rain':
          // 雨声 - 粉红噪音 + 随机脉冲
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
            // 添加雨滴效果
            if (Math.random() < 0.001) {
              output[i] += (Math.random() - 0.5) * 0.3;
            }
          }
          break;
          
        case 'forest':
          // 森林 - 低频噪音 + 鸟鸣模拟
          for (let i = 0; i < len; i++) {
            output[i] = (Math.random() * 2 - 1) * 0.1;
            // 模拟风吹树叶
            output[i] += Math.sin(i * 0.0001) * 0.05;
          }
          break;
          
        case 'ocean':
          // 海浪 - 周期性波动
          for (let i = 0; i < len; i++) {
            const wave = Math.sin(i * 0.00005) * 0.5 + 0.5;
            output[i] = (Math.random() * 2 - 1) * wave * 0.3;
          }
          break;
          
        case 'fire':
          // 篝火 - 棕色噪音 + 噼啪声
          let lastOut = 0;
          for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5;
            // 噼啪声
            if (Math.random() < 0.0005) {
              output[i] += (Math.random() - 0.5) * 0.5;
            }
          }
          break;
          
        case 'wind':
          // 微风 - 低频波动噪音
          for (let i = 0; i < len; i++) {
            const mod = Math.sin(i * 0.00003) * 0.5 + 0.5;
            output[i] = (Math.random() * 2 - 1) * mod * 0.15;
          }
          break;
          
        case 'night':
          // 夜晚 - 蟋蟀声
          for (let i = 0; i < len; i++) {
            output[i] = (Math.random() * 2 - 1) * 0.05;
            // 蟋蟀叫声模拟
            if (Math.sin(i * 0.01) > 0.8) {
              output[i] += Math.sin(i * 0.5) * 0.1;
            }
          }
          break;
          
        default:
          // 默认白噪音
          for (let i = 0; i < len; i++) {
            output[i] = Math.random() * 2 - 1;
          }
      }
    }
    
    /**
     * 获取滤波器频率
     */
    getFilterFrequency(type) {
      const frequencies = {
        rain: 3000,
        forest: 2000,
        ocean: 1500,
        fire: 2500,
        wind: 1000,
        night: 4000
      };
      return frequencies[type] || 2000;
    }
    
    /**
     * 设置音量
     */
    setNoiseVolume(volume) {
      if (this.noiseGain) {
        this.noiseGain.gain.value = volume;
      }
    }
    
    /**
     * 停止白噪音
     */
    stopWhiteNoise() {
      if (this.currentNoise) {
        this.currentNoise.stop();
        this.currentNoise.disconnect();
        this.currentNoise = null;
      }
      this.isNoisePlaying = false;
    }
    
    async updateDSI() {
      // 检查扩展上下文是否有效
      if (!chrome.runtime?.id) {
        return;
      }
      
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_DSI' });
        
        if (response && response.success) {
          this.dsi = response.data.dsi || 0;
          this.level = response.data.level || 0;
          
          // 根据 DSI 值计算正确的级别（修复逻辑漏洞）
          let calculatedLevel = 0;
          if (this.dsi >= 80) {
            calculatedLevel = 3;  // 高度压力 - 视觉疗愈
          } else if (this.dsi >= 60) {
            calculatedLevel = 2;  // 中度压力 - 阅读模式
          } else if (this.dsi >= 30) {
            calculatedLevel = 1;  // 轻度压力 - 柔和模式
          } else {
            calculatedLevel = 0;  // 状态良好 - 正常浏览
          }
          
          // 使用计算出的级别，而不是 this.level（可能未同步）
          const displayLevel = calculatedLevel;
          
          // 更新显示
          const dsiValue = document.getElementById('mindflow-dsi-value');
          const dsiRingProgress = document.getElementById('mindflow-dsi-ring-progress');
          const dsiStatus = document.getElementById('mindflow-dsi-status');
          const dsiRingContainer = document.querySelector('.mindflow-dsi-ring-container');
          
          if (dsiValue) {
            dsiValue.textContent = Math.round(this.dsi);
            dsiValue.className = 'mindflow-dsi-number mindflow-dsi-level-' + displayLevel;
          }
          
          // 更新圆环进度条 - 使用 conic-gradient 实现填充效果
          if (dsiRingContainer) {
            const progress = this.dsi / 100;
            const levelColors = {
              0: '#2D6A4F',  // 森林绿
              1: '#95D5B2',  // 鼠尾草绿
              2: '#B07D62',  // 大地棕
              3: '#C62828'   // 红色（极度过载）
            };
            const bgColor = '#E0E0E0';
            const fillColor = levelColors[displayLevel] || levelColors[0];
            
            // 使用 conic-gradient 创建填充圆环（从顶部开始，顺时针）
            const percentage = progress * 100;
            dsiRingContainer.style.background = `conic-gradient(from 0deg, ${fillColor} 0% ${percentage}%, ${bgColor} ${percentage}% 100%)`;
            dsiRingContainer.className = 'mindflow-dsi-ring-container mindflow-dsi-level-' + displayLevel;
          }
          
          if (dsiStatus) {
            const statusTexts = [
              '😊 状态良好',
              '😐 轻度压力',
              '😰 中度压力',
              '😫 极度过载'
            ];
            dsiStatus.textContent = statusTexts[displayLevel];
            dsiStatus.className = 'mindflow-dsi-status-badge mindflow-dsi-level-' + displayLevel;
          }
          
          // 更新级别指示器 - 使用计算出的级别
          for (let i = 0; i <= 3; i++) {
            const levelItem = document.getElementById(`mindflow-level-${i}`);
            if (levelItem) {
              if (i === displayLevel) {
                levelItem.classList.add('active');
              } else {
                levelItem.classList.remove('active');
              }
            }
          }
          
          // 更新悬浮按钮
          this.updateFloatButton();
        }
      } catch (error) {
        // 扩展上下文可能无效，静默忽略
      }
    }
    
    async resetDSI() {
      if (!chrome.runtime?.id) {
        return;
      }
      
      try {
        await chrome.runtime.sendMessage({ type: 'RESET_DSI' });
        console.log('[Sidebar] DSI 已重置');
        
        // 立即更新显示
        this.updateDSI();
      } catch (error) {
        // 静默忽略
      }
    }
    
    show() {
      if (this.panel && !this.isVisible) {
        this.panel.classList.add('visible');
        this.isVisible = true;
      }
    }
    
    hide() {
      if (this.panel && this.isVisible) {
        this.panel.classList.remove('visible');
        this.isVisible = false;
      }
    }
    
    toggle() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    }
  }
  
  // ============================================
  // 初始化
  // ============================================
  
  // 创建行为监听器
  const behaviorMonitor = new BehaviorMonitor();
  
  // 创建干预管理器
  const interventionManager = new InterventionManager();
  
  // 创建侧边栏面板
  const sidebarPanel = new SidebarPanel();
  
  // 通知 background.js content script 已就绪，并发送页面信息
  try {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({ 
        type: 'CONTENT_READY',
        payload: {
          url: window.location.href,
          title: document.title
        }
      }).catch(() => {});
    }
  } catch (e) {
    // 静默忽略
  }
  
  console.log('[MindFlow] 初始化完成（基于心理学理论优化版）');
  
})();

