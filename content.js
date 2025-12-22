/**
 * MindFlow - Content Script
 * 负责：
 * 1. 行为感知：监听滚动速度和点击频率
 * 2. 干预执行：接收 background.js 指令并执行三级干预
 * 3. p5.js 渲染：Level 3 视觉疗愈动画
 */

(function () {
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
    THERAPY_DURATION: 30000,      // 视觉疗愈时长 (ms) - 生产环境 30秒
    BREATH_CYCLE: 10000,           // 呼吸周期 (ms)
    // 阅读模式配置
    READER_MODE_WIDTH: '800px',
    READER_MODE_PADDING: '40px',
  };

  // ============================================
  // 本地情绪语料库 (Emotional Quotes)
  // 90%情况使用本地语料，零延迟响应
  // ============================================

  const EMOTIONAL_QUOTES = {
    // 低压力模式 (DSI 0-50): 夸夸/鼓励
    LOW_DSI: [
      "✨ 你的专注力真棒！保持这个节奏~",
      "🌿 心流状态已开启，感受这份宁静吧",
      "🌸 你正在高效地阅读，继续加油！",
      "💚 状态极佳，这才是理想的浏览方式",
      "🍀 今天的你特别专注呢！",
      "🌻 慢慢来，不急，你做得很好",
      "🌈 保持这份平静，你值得拥有美好",
      "🦋 思维清晰，效率在线！",
      "🌊 像海面一样平静，真舒服",
      "🎋 竹林般的宁静，很适合你现在的状态",
      "🌙 静水流深，专注的你最迷人",
      "🍃 微风轻拂，一切刚刚好",
      "💫 你正处于最佳状态，享受这一刻",
      "🌺 花开不语，静静绽放的你真好看",
      "☘️ 三叶草为你带来幸运~"
    ],

    // 高压力模式 (DSI 51-100): 安抚/治愈
    HIGH_DSI: [
      "💚 慢下来，深呼吸，一切都会好起来的",
      "🌊 压力就像波浪，它终会退去",
      "🧘 闭上眼睛，感受三次呼吸",
      "🌿 没关系的，休息一下再继续",
      "🌸 你已经很努力了，允许自己喘口气",
      "🌙 累了就停下来，天不会塌的",
      "🍵 喝杯热茶，让身体和心灵都暖一暖",
      "🌈 雨后总会有彩虹，相信自己",
      "💆 现在最重要的是你自己，照顾好自己",
      "🌻 向日葵也需要阳光，你也需要休息",
      "🦋 不是每一刻都要高效，放松也是进步",
      "🌲 大树扎根需要时间，成长不必着急",
      "💭 脑子累了？让它放空一会儿吧",
      "🎐 风铃在轻轻摇曳，心也跟着慢下来",
      "🌊 让思绪随波逐流，不必抓住每一朵浪花"
    ],

    // 早安模式 (6:00-12:00)
    MORNING: [
      "☀️ 早安！新的一天，新的开始",
      "🌅 朝阳正好，愿你元气满满",
      "🐦 小鸟已经开始歌唱，你也开始美好的一天吧",
      "🌸 早起的你真棒！今天也要加油哦",
      "☕ 来一杯咖啡，唤醒一整天的活力",
      "🌻 向阳而生，今天也是向上的一天",
      "🌈 早晨的空气最清新，深呼吸~",
      "🦋 蝴蝶正在花间飞舞，美好正在发生",
      "🍃 晨风轻拂，带走昨天的疲惫",
      "💪 新的一天，你准备好迎接挑战了吗？"
    ],

    // 晚安模式 (18:00-24:00)
    NIGHT: [
      "🌙 该放下了，给大脑一个休息的理由",
      "⭐ 星星已经出来了，你也该休息了",
      "🌃 夜深了，明天会更好的",
      "🛏️ 好好休息，明天又是元气满满的一天",
      "🌌 银河正在闪烁，做个好梦吧",
      "🦉 猫头鹰开始工作了，而你该睡觉了",
      "🍵 睡前一杯温水，今天辛苦了",
      "🌸 月光温柔，愿你有个好梦",
      "💤 闭上眼睛，让一切归于平静",
      "🌙 晚安，明天的你会更好的"
    ]
  };

  /**
   * 根据DSI值和当前时间获取随机治愈语录
   * @param {number} dsi - 当前压力指数
   * @returns {string} 随机语录
   */
  function getRandomQuote(dsi) {
    const hour = new Date().getHours();
    let pool = [];

    // 优先按时间段选择
    if (hour >= 6 && hour < 12) {
      pool = EMOTIONAL_QUOTES.MORNING;
    } else if (hour >= 22 || hour < 2) {
      pool = EMOTIONAL_QUOTES.NIGHT;
    } else {
      // 其他时间按DSI选择
      pool = dsi <= 50 ? EMOTIONAL_QUOTES.LOW_DSI : EMOTIONAL_QUOTES.HIGH_DSI;
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

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

      // 新增：焦虑行为检测状态
      this.scrollDirection = 0;      // 1: down, -1: up, 0: none
      this.directionChanges = 0;     // 记录反向滚动的次数（焦虑指标 - Yo-yo Effect）
      this.lastClickPosition = { x: 0, y: 0 };
      this.rageClickCount = 0;       // 记录愤怒点击次数 (Rage Clicks)

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

      // 1. 计算滚动方向并检测 Yo-yo Effect (往复滚动)
      const currentDirection = currentPosition > this.lastScrollPosition ? 1 : -1;

      // 如果发生位移且方向改变
      if (Math.abs(currentPosition - this.lastScrollPosition) > 10) { // 忽略微小震动
        if (this.scrollDirection !== 0 && currentDirection !== this.scrollDirection) {
          // 如果短时间内（例如 1000ms）改变方向，视为焦虑特征
          if (now - this.lastScrollTime < 1000) {
            this.directionChanges++;
            // console.debug('[Monitor] 检测到反向滚动', this.directionChanges);
          }
        }
        this.scrollDirection = currentDirection;
      }

      this.lastScrollPosition = currentPosition;
      this.lastScrollTime = now;

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
    handleClick(event) {
      const now = Date.now();
      const x = event.clientX;
      const y = event.clientY;

      // 检测 Rage Clicks (死板点击)
      // 在同一坐标（或极小范围内 20px）短时间多次点击
      const dist = Math.sqrt(
        Math.pow(x - this.lastClickPosition.x, 2) +
        Math.pow(y - this.lastClickPosition.y, 2)
      );

      if (dist < 20 && (now - this.lastClickTime < 500)) {
        this.rageClickCount++;
        // console.debug('[Monitor] 检测到重复点击', this.rageClickCount);
      } else {
        // 重置（也许应该随时间衰减，但简单起见先重置或不增加）
        // 这里我们不做重置，只在 report 后重置，因为是累积计数
      }

      this.lastClickPosition = { x, y };
      this.lastClickTime = now;

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
      // 检查扩展上下文是否有效
      if (!chrome.runtime?.id) {
        return;
      }

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
              directionChanges: this.directionChanges, // 上报往复滚动次数
              rageClickCount: this.rageClickCount,     // 上报暴躁点击次数
              timestamp: Date.now()
            }
          }, (response) => {
            // 上报成功后，重置增量计数器（scrollEvents 和 clickEvents 是滑动窗口，不需要重置）
            this.directionChanges = Math.max(0, this.directionChanges - 1); // 缓慢衰减而不是直接清零，保留一点历史状态
            this.rageClickCount = 0; // Rage clicks 可以清零，因为是瞬时计数
            // 处理响应（如果需要）
            if (chrome.runtime.lastError) {
              // 静默忽略错误（Service Worker 可能未就绪）
            }
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

      // ✅ 新增：当前氛围类型
      this.currentAtmosphere = null;

      // ✅ 新增：氛围定时器管理
      this.atmoTimers = [];
      this.atmoIntervals = [];

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

      // ✅ 新增：监听氛围切换事件 (从 Sidebar 发出)
      document.addEventListener('mindflow:atmosphere-change', (e) => {
        this.setAtmosphere(e.detail.type);
      });

      console.log('[Intervention] 干预管理器已初始化');
    }

    /**
     * 显示渐进式建议提示（不强制干预）
     * 基于自我决定论，把选择权还给用户
     */
    showSuggestion(payload) {
      const { dsi, suggestionType, title, text } = payload; // **[修改]** 增加 title, text

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
            ${title || (isStrong ? '检测到页面杂乱' : '休息一下？')} <!-- **[修改]** -->
          </div>
          <div class="mindflow-suggestion-text">
            ${text || (isStrong
          ? '开启纯净阅读模式，让阅读更舒适？'
          : '当前压力指数较高，可以考虑开启护眼模式')} <!-- **[修改]** -->
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
     * 激活柔和模式 - 纸质护眼模式 (Paper Mode)
     */
    activateSoftMode() {
      if (this.softModeActive) return;

      // 1. 创建护眼颜色层 (底层)
      let colorLayer = document.getElementById('mindflow-paper-layer');
      if (!colorLayer) {
        colorLayer = document.createElement('div');
        colorLayer.id = 'mindflow-paper-layer';
        colorLayer.className = 'mindflow-paper-overlay';
        document.documentElement.appendChild(colorLayer);
      }

      // 2. 创建氛围动画层 (顶层 - 独立!)
      // 这一步是关键：把它独立出来，不要放在 colorLayer 里面
      let atmoLayer = document.getElementById('mindflow-atmosphere-container');
      if (!atmoLayer) {
        atmoLayer = document.createElement('div');
        atmoLayer.id = 'mindflow-atmosphere-container';
        atmoLayer.className = 'mindflow-atmosphere-container';
        document.documentElement.appendChild(atmoLayer);
      }

      // 激活
      requestAnimationFrame(() => {
        colorLayer.classList.add('mindflow-paper-active');

        // 【修改点】：默认自动开启 'forest' 视觉氛围（仅视觉，无声）
        // 如果用户之前没有手动选过氛围，或者当前没有氛围，则默认给一个
        if (!this.currentAtmosphere) {
          this.setAtmosphere('forest');
        } else {
          // 如果已有（比如用户之前选了 fire），恢复它
          this.setAtmosphere(this.currentAtmosphere);
        }
      });

      this.softModeActive = true;
      console.log('[Level 1] 纸质护眼模式已激活 (自动加载视觉氛围)');
    }

    deactivateSoftMode() {
      const colorLayer = document.getElementById('mindflow-paper-layer');
      const atmoLayer = document.getElementById('mindflow-atmosphere-container');

      if (colorLayer) colorLayer.classList.remove('mindflow-paper-active');

      // 同时也移除氛围
      if (atmoLayer) {
        atmoLayer.innerHTML = '';
        atmoLayer.className = 'mindflow-atmosphere-container'; // 重置类名
      }
      this.stopAtmosphereTimers();

      setTimeout(() => {
        colorLayer?.remove();
        atmoLayer?.remove();
      }, 600);

      this.softModeActive = false;
      console.log('[Level 1] 纸质护眼模式已停用');
    }

    /**
     * 设置氛围类型 (修复版：针对独立图层操作)
     * @param {string|null} type - 'thunder', 'forest', 'ocean', 'fire', 'wind', 'night' 或 null (关闭)
     */
    setAtmosphere(type) {
      // 映射旧的 thunder 到 rain
      const effectType = (type === 'thunder') ? 'rain' : type;

      this.currentAtmosphere = type; // 保存原始类型
      if (!this.softModeActive) return;

      // 选中独立层
      const atmoContainer = document.getElementById('mindflow-atmosphere-container');
      const colorLayer = document.getElementById('mindflow-paper-layer');
      if (!atmoContainer || !colorLayer) return;

      // 1. 清理旧状态
      atmoContainer.innerHTML = '';
      atmoContainer.className = 'mindflow-atmosphere-container'; // 清除旧的背景类
      this.stopAtmosphereTimers();

      // 2. 重置护眼层的颜色 (让不同模式有不同底色)
      // 先移除所有特定颜色类，恢复默认
      colorLayer.className = 'mindflow-paper-overlay mindflow-paper-active';

      if (!effectType) {
        // 恢复默认羊皮纸色
        console.log('[Atmosphere] 关闭氛围');
        return;
      }

      // 3. 应用新状态
      atmoContainer.classList.add(`atmo-effect-${effectType}`); // 添加特效类
      colorLayer.classList.add(`paper-tint-${effectType}`);     // 添加底色类

      console.log(`[Atmosphere] 切换模式: ${effectType}`);

      // ✅ 关键修改：如果阅读模式处于激活状态，同步更新阅读模式的背景色
      if (this.readerModeActive && this.readerOverlay) {
        // 移除旧的 tint 类
        this.readerOverlay.classList.forEach(cls => {
          if (cls.startsWith('paper-tint-')) {
            this.readerOverlay.classList.remove(cls);
          }
        });
        // 添加新的 tint 类
        this.readerOverlay.classList.add(`paper-tint-${effectType}`);

        // 强制重绘粒子（因为容器被清空了）
        // 注意：粒子容器是在阅读模式之上的（通过 CSS z-index 控制）
      }

      // 兼容处理：如果用户之前选了 night、rain 或 wind，现在不处理或转为默认
      if (type === 'night' || type === 'rain' || type === 'wind') return;

      // 4. 生成粒子
      switch (effectType) {
        case 'forest': this.initForest(atmoContainer); break;
        case 'ocean': this.initOcean(atmoContainer); break;
        case 'fire': this.initFire(atmoContainer); break;
        // case 'rain': 已删除
        // case 'wind': 已删除
        // case 'night': 已删除
      }
    }

    /**
     * 清理定时器
     */
    stopAtmosphereTimers() {
      if (this.atmoTimers) {
        this.atmoTimers.forEach(t => clearTimeout(t));
        this.atmoTimers = [];
      }
      if (this.atmoIntervals) {
        this.atmoIntervals.forEach(i => clearInterval(i));
        this.atmoIntervals = [];
      }
    }

    // ==========================================
    // 粒子生成器方法
    // ==========================================

    // initRain 方法已删除

    initForest(container) {
      // 创建落叶 🍃 - 减速：时间延长一倍
      const leafCount = 20; // 少量即可
      const emojis = ['🍃', '🍂'];

      for (let i = 0; i < leafCount; i++) {
        const leaf = document.createElement('div');
        leaf.className = 'mf-particle mf-leaf';
        leaf.innerText = emojis[Math.floor(Math.random() * emojis.length)];
        leaf.style.left = Math.random() * 100 + 'vw';
        leaf.style.fontSize = (Math.random() * 10 + 15) + 'px';
        // 修改动画时长：从 5-10秒 改为 10-20秒
        leaf.style.animationDuration = (Math.random() * 10 + 10) + 's';
        leaf.style.animationDelay = (Math.random() * 10) + 's';
        container.appendChild(leaf);
      }
    }

    initOcean(container) {
      // 移除之前的 wave div，只保留 CSS 背景呼吸

      // 气泡：加大、变亮、变慢
      for (let i = 0; i < 20; i++) {
        const bubble = document.createElement('div');
        bubble.className = 'mf-particle mf-bubble';
        // 尺寸变大：10px - 40px
        const size = Math.random() * 30 + 10;
        bubble.style.width = size + 'px';
        bubble.style.height = size + 'px';
        bubble.style.left = Math.random() * 100 + 'vw';
        // 速度极慢：8s - 15s
        bubble.style.animationDuration = (Math.random() * 7 + 8) + 's';
        bubble.style.animationDelay = (Math.random() * 10) + 's';
        container.appendChild(bubble);
      }
    }

    initFire(container) {
      // 底部光晕 (CSS已处理)
      const glow = document.createElement('div');
      glow.className = 'mf-fire-glow';
      container.appendChild(glow);

      // 全屏余烬
      for (let i = 0; i < 50; i++) {
        const spark = document.createElement('div');
        spark.className = 'mf-particle mf-spark';
        // 随机大小
        const size = Math.random() * 3 + 1;
        spark.style.width = size + 'px';
        spark.style.height = size + 'px';

        // 全屏随机分布 X 轴
        spark.style.left = Math.random() * 100 + 'vw';

        // 动画
        spark.style.animationName = 'mf-ember-float';
        spark.style.animationDuration = (Math.random() * 5 + 5) + 's'; // 5-10s
        spark.style.animationDelay = (Math.random() * 5) + 's';

        // 随机摇摆幅度 (-50px 到 50px)
        spark.style.setProperty('--sway', (Math.random() * 100 - 50) + 'px');

        container.appendChild(spark);
      }
    }

    // initWind 方法已删除

    // initNight 方法已删除

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
      // ✅ 关键修改：默认应用当前氛围的颜色类
      const atmoClass = this.currentAtmosphere ? `paper-tint-${this.currentAtmosphere}` : '';
      this.readerOverlay.className = `mindflow-reader-overlay ${atmoClass}`;

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
              <span class="mindflow-summary-badge">Google Gemini</span>
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

      // 确保覆盖层在最上层，并隐藏原页面内容
      document.body.appendChild(this.readerOverlay);

      // 隐藏原页面滚动，防止分层显示
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // 确保覆盖层在文档最顶层（使用内联样式确保优先级）
      // ✅ 注意：CSS 中已经提升了 atmosphere-container 的 z-index，所以这里不需要特别担心遮挡
      this.readerOverlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        min-height: 100vh !important;
        z-index: 2147483647 !important;
        /* background: var(--mindflow-reader-bg) !important;  <-- 移除此行，由 CSS 类控制 */
      `;

      // 保存原始 overflow 以便恢复
      this.originalBodyOverflow = originalOverflow;

      // 绑定关闭按钮事件
      const closeButton = document.getElementById('mindflow-close-reader');
      if (closeButton) {
        closeButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.deactivateReaderMode();
        });
      }

      // ✅ 关键修改：激活阅读模式时，确保氛围动画正常播放（且图层在阅读模式之上）
      // 这里的 setAtmosphere 会重置容器并重新生成粒子，确保粒子可见
      if (this.currentAtmosphere) {
        this.setAtmosphere(this.currentAtmosphere);
      }

      this.readerModeActive = true;
      console.log('[Level 2] 阅读模式已激活，继承氛围:', this.currentAtmosphere || '无');

      // **[新增]** 通知 background.js 阅读模式已激活
      chrome.runtime.sendMessage({
        type: 'READER_MODE_STATE',
        payload: { active: true }
      }).catch(() => { });

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

      // 恢复原页面滚动
      if (this.originalBodyOverflow !== undefined) {
        document.body.style.overflow = this.originalBodyOverflow;
        this.originalBodyOverflow = undefined;
      } else {
        document.body.style.overflow = '';
      }

      this.readerModeActive = false;
      console.log('[Level 2] 阅读模式已停用');

      // **[新增]** 通知 background.js 阅读模式已停用
      chrome.runtime.sendMessage({
        type: 'READER_MODE_STATE',
        payload: { active: false }
      }).catch(() => { });
    }

    /**
     * 模拟 Readability 提取页面正文内容
     * 优化：强力清洗 DOM，移除干扰样式，解决排版错乱
     * @returns {{title: string, content: string, textContent: string}|null}
     */
    extractContent() {
      try {
        // 1. 获取标题
        const title = document.querySelector('h1')?.textContent
          || document.querySelector('title')?.textContent
          || '未知标题';

        // 2. 智能查找正文容器
        // 优先级：显式文章标签 > 特定类名 > 启发式查找
        const contentSelectors = [
          'article',
          '[role="main"]',
          '.article-content',
          '.post-content',
          '.entry-content',
          '#content',
          '.main-content',
          'main'
        ];

        let contentElement = null;
        for (const selector of contentSelectors) {
          // 查找该选择器下的元素，并检查是否包含足够多的 p 标签 (至少3个)，避免选中空的容器或导航栏
          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (candidate.querySelectorAll('p').length > 3) {
              contentElement = candidate;
              break;
            }
          }
          if (contentElement) break;
        }

        // 3. 如果没找到合适的容器，执行兜底策略：提取所有 p 标签
        // 针对门户网站首页或非标准页面
        if (!contentElement) {
          console.log('[Reader] 未找到明确的正文容器，使用兜底策略');
          // 创建一个虚拟容器
          contentElement = document.createElement('div');
          // 获取页面所有 p 标签，过滤掉太短的（可能是导航或页脚）
          const allParagraphs = document.querySelectorAll('body p');
          let validParagraphCount = 0;

          allParagraphs.forEach(p => {
            // 简单的启发式：段落长度大于 20 字符，或者是图片
            if (p.textContent.trim().length > 20 || p.querySelector('img')) {
              contentElement.appendChild(p.cloneNode(true));
              validParagraphCount++;
            }
          });

          if (validParagraphCount < 3) {
            console.warn('[Reader] 有效段落太少，可能不是文章页');
          }
        } else {
          // 克隆找到的容器，避免修改原页面
          contentElement = contentElement.cloneNode(true);
        }

        // 4. 清洗 DOM (核心修复步骤)
        // 移除无关元素
        const removeSelectors = [
          'script', 'style', 'noscript', 'iframe', 'svg', 'button', 'input', 'textarea', 'select', 'form',
          'nav', 'header', 'footer', 'aside',
          '.sidebar', '.ad', '.advertisement', '.social-share', '.comments', '.related-posts',
          '[id*="comment"]', '[class*="comment"]', '[id*="share"]', '[class*="share"]'
        ];

        // 注意：先移除 MindFlow 自己的元素
        contentElement.querySelectorAll('[id^="mindflow-"], [class^="mindflow-"]').forEach(el => el.remove());

        removeSelectors.forEach(selector => {
          contentElement.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 5. 强力去样式 (Strip Attributes)
        // 递归遍历所有子节点，移除 class, id, style 等可能导致样式冲突的属性
        const stripAttributes = (node) => {
          if (node.nodeType === 1) { // 元素节点
            // 白名单属性，其他全部移除
            const allowedAttrs = ['src', 'href', 'alt', 'title', 'width', 'height', 'datetime'];

            // 获取所有属性名
            const attrs = Array.from(node.attributes).map(a => a.name);

            attrs.forEach(attrName => {
              if (!allowedAttrs.includes(attrName)) {
                node.removeAttribute(attrName);
              }
            });

            // 特殊处理：移除空的 div 或 span (可选，为了更干净)
            // 但要保留包含 img 的 div
            if ((node.tagName === 'DIV' || node.tagName === 'SPAN') &&
              node.innerHTML.trim() === '' && !node.querySelector('img')) {
              // node.remove(); // 遍历中删除可能会有问题，这里暂不删除，交给 CSS 处理空元素
            }

            // 递归处理子节点
            let child = node.firstChild;
            while (child) {
              const next = child.nextSibling;
              stripAttributes(child);
              child = next;
            }
          }
        };

        stripAttributes(contentElement);

        const content = contentElement.innerHTML;
        const textContent = contentElement.textContent || '';

        // 检查提取结果是否为空
        if (content.trim().length === 0) {
          throw new Error('提取内容为空');
        }

        return {
          title: title.trim(),
          content: content,
          textContent: textContent.trim().slice(0, 5000)
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
        // 检查文本内容是否有效
        if (!textContent || textContent.trim().length < 50) {
          throw new Error('文章内容过短，无法生成摘要');
        }

        // 显示加载动画
        summaryContent.innerHTML = `
          <div class="mindflow-summary-loading">
            <span class="mindflow-loading-spinner"></span>
            <span>正在分析文章内容，生成智能摘要...</span>
          </div>
        `;

        // 🚀 修改点：发送消息给 background.js 处理 API 请求（避免 CORS 问题）
        // 检查扩展上下文
        if (!chrome.runtime?.id) {
          throw new Error('扩展上下文无效，请刷新页面后重试');
        }

        console.log('[AI Summary] 开始请求摘要，文本长度:', textContent.length);

        // 设置超时处理
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('请求超时（30秒），请检查网络连接或稍后重试'));
          }, 30000); // 30秒超时
        });

        const messagePromise = chrome.runtime.sendMessage({
          type: 'CALL_LLM_API',
          payload: { text: textContent }
        }).catch(err => {
          // 检查是否是扩展上下文错误
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || '无法连接到扩展后台服务';
            console.error('[AI Summary] 扩展上下文错误:', errorMsg);
            throw new Error(`${errorMsg}，请检查扩展是否正常运行`);
          }
          console.error('[AI Summary] 消息发送失败:', err);
          throw err;
        });

        // 使用 Promise.race 来处理超时
        const response = await Promise.race([messagePromise, timeoutPromise]);

        // 检查响应是否有效
        if (!response) {
          console.error('[AI Summary] 响应为空');
          throw new Error('未收到服务器响应，可能是网络问题或扩展服务未响应');
        }

        console.log('[AI Summary] 收到响应:', response.success ? '成功' : '失败');

        if (!response.success) {
          const errorMsg = response?.error || '请求失败';
          throw new Error(errorMsg);
        }

        // 检查返回的摘要数据
        if (!response.data || !response.data.trim()) {
          throw new Error('生成的摘要为空，请重试');
        }

        // 格式化摘要内容
        const formattedSummary = this.formatSummary(response.data);
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
      // 🐛 Bug 修复：防止重复加载，先强制清理
      if (this.p5Instance) {
        this.deactivateVisualTherapy();
      }
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

      // 绑定跳过按钮
      document.getElementById('mindflow-therapy-skip')?.addEventListener('click', () => {
        console.log('[Level 3] 用户选择跳过视觉疗愈');
        this.deactivateVisualTherapy(false); // 参数 false 表示未完成
      });

      // 播放入场动画
      // ... (现有代码)

      // 初始化 p5.js 实例
      this.initP5Instance();

      // ✅ 倒计时逻辑：从配置中获取秒数 (30000 / 1000 = 30秒)
      let countdown = Math.floor(CONFIG.THERAPY_DURATION / 1000);
      const countdownEl = document.getElementById('mindflow-therapy-countdown');

      // 清除旧的 interval 防止冲突
      if (this.countdownInterval) clearInterval(this.countdownInterval);

      this.countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) {
          countdownEl.textContent = `${countdown} 秒后自动关闭`;
        }
        if (countdown <= 0) {
          clearInterval(this.countdownInterval);
          // ✅ 时间到，传入 true 表示“疗愈完成”
          this.deactivateVisualTherapy(true);
        }
      }, 1000);

      this.therapyActive = true;
      console.log('[Level 3] 视觉疗愈已激活（4-6 呼吸法）');

      // ✅ 发送疗愈开始信号给 background.js（用于加速衰减）
      chrome.runtime.sendMessage({
        type: 'THERAPY_ACTIVE',
        payload: { active: true }
      }).catch(() => { });
    }

    /**
     * 关闭视觉疗愈
     * @param {boolean} completed - 是否完整播放结束
     */
    async deactivateVisualTherapy(completed = false) {
      // 清除倒计时
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }

      // 清除超时定时器
      if (this.therapyTimeout) {
        clearTimeout(this.therapyTimeout);
        this.therapyTimeout = null;
      }

      // 销毁 p5 实例和 DOM
      if (this.p5Instance) {
        this.p5Instance.remove();
        this.p5Instance = null;
      }

      const container = document.getElementById('mindflow-therapy-container');
      if (container) container.remove();
      this.therapyContainer = null;

      this.therapyActive = false;

      // ✅ 发送疗愈结束信号给 background.js（停止加速衰减）
      chrome.runtime.sendMessage({
        type: 'THERAPY_ACTIVE',
        payload: { active: false }
      }).catch(() => { });

      // ✅ 核心逻辑：如果疗愈完成，发送信号给后台
      if (completed) {
        console.log('[Level 3] 🧘 疗愈完整结束，发送回退信号');
        chrome.runtime.sendMessage({ type: 'THERAPY_COMPLETED' }).catch(() => { });

        // 简单的成功反馈
        this.showSuggestion({
          suggestionType: 'gentle',
          dsi: 45,
          title: '恭喜！您已完成放松', // **[新增]** 更明确的标题
          text: 'DSI 已回落到心流区，继续保持专注吧！' // **[新增]** 更明确的文本
        });
      } else {
        console.log('[Level 3] 视觉疗愈被中断/跳过');
      }

      console.log('[Level 3] 视觉疗愈已关闭');
    }

    /**
     * 初始化 p5.js 实例 (生物荧光呼吸 - Bioluminescent Breath)
     */
    initP5Instance() {
      if (typeof p5 === 'undefined') return;
      const container = this.therapyContainer;

      const sketch = (p) => {
        // 4-6 呼吸法参数
        const INHALE = 4000;
        const EXHALE = 6000;
        const TOTAL_CYCLE = INHALE + EXHALE;

        let startTime;
        let particles = [];
        const PARTICLE_COUNT = 150;
        let colors = []; // 将在 setup 中初始化

        class Particle {
          constructor() {
            this.reset();
            // 初始分布：高斯分布，更聚集在中心
            const r = p.randomGaussian(0, p.min(p.width, p.height) * 0.2);
            const theta = p.random(p.TWO_PI);
            this.pos = p.createVector(
              p.width / 2 + r * p.cos(theta),
              p.height / 2 + r * p.sin(theta)
            );
          }

          reset() {
            this.angle = p.random(p.TWO_PI);
            this.radius = p.random(60, p.max(p.width, p.height) * 0.5);
            this.size = p.random(2, 6); // 稍微变大一点
            // 确保颜色已初始化
            if (colors.length > 0) {
              this.color = p.random(colors);
            } else {
              this.color = p.color(255);
            }
            this.speedOffset = p.random(0.5, 2.0);
            this.originalRad = this.radius;
            this.drift = p.createVector(p.random(-1, 1), p.random(-1, 1));
          }

          update(progress, isInhaling, center) {
            // 呼吸动力学：模拟生物有机体的膨胀收缩
            // 吸气：粒子向外扩张 (肺部充气) 还是向内汇聚 (能量聚集)?
            // 之前逻辑是吸气汇聚，呼气扩散。现在调整为：
            // 吸气：粒子活跃，稍微向中心聚集（张力储备）
            // 呼气：粒子平滑向外流淌（释放）

            let targetRadius;

            if (isInhaling) {
              // 吸气时，轻微收缩凝聚
              targetRadius = this.originalRad * 0.85;
            } else {
              // 呼气时，舒缓扩散
              targetRadius = this.originalRad * 1.15;
            }

            // 使用 Ease 缓动
            const noiseVal = p.noise(this.pos.x * 0.005, this.pos.y * 0.005, p.frameCount * 0.005);
            const currentRadius = p.lerp(this.radius, targetRadius, progress) + (noiseVal * 30);

            // 粒子自身的旋转漂浮
            this.angle += 0.001 * this.speedOffset;

            this.pos.x = center.x + p.cos(this.angle) * currentRadius + this.drift.x;
            this.pos.y = center.y + p.sin(this.angle) * currentRadius + this.drift.y;

            // 稍微改变大小模拟闪烁
            this.pulsingSize = this.size * (0.8 + noiseVal * 0.4);
          }

          draw() {
            // 使用 additive 混合模式让重叠粒子发光
            p.drawingContext.globalCompositeOperation = 'screen';
            p.noStroke();
            p.fill(this.color);
            // 给粒子微弱的发光
            p.circle(this.pos.x, this.pos.y, this.pulsingSize);
            p.drawingContext.globalCompositeOperation = 'source-over'; // 恢复默认
          }
        }

        p.setup = function () {
          const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
          canvas.parent(container);
          startTime = p.millis();

          // 初始化颜色（莫兰迪/生物荧光绿）
          // 增加亮度以在深色背景下更明显
          colors = [
            p.color(180, 240, 200, 180),  // 高亮薄荷
            p.color(95, 230, 160, 160),   // 荧光绿
            p.color(200, 250, 220, 150),  // 亮白绿
            p.color(45, 106, 79, 100)     // 深绿点缀
          ];

          for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(new Particle());
          }
        };

        p.draw = function () {
          p.clear();

          const elapsed = p.millis() - startTime;
          const cycleTime = elapsed % TOTAL_CYCLE;
          const center = p.createVector(p.width / 2, p.height / 2);

          let progress, isInhaling;
          let phaseText = "";
          let timerText = "";

          // 计算平滑的呼吸进度 (0.0 -> 1.0)
          // 改用 Cosine 插值： (1 - cos(t * PI)) / 2
          if (cycleTime < INHALE) {
            isInhaling = true;
            const t = cycleTime / INHALE;
            // 吸气：0 -> 1
            progress = (1 - p.cos(t * p.PI)) / 2;
            phaseText = "吸气 (Inhale)";
            timerText = Math.ceil((INHALE - cycleTime) / 1000).toString();
          } else {
            isInhaling = false;
            const t = (cycleTime - INHALE) / EXHALE;
            // 呼气：1 -> 0
            progress = 1 - ((1 - p.cos(t * p.PI)) / 2);
            phaseText = "呼气 (Exhale)";
            timerText = Math.ceil((EXHALE - (cycleTime - INHALE)) / 1000).toString();
          }

          // DOM 文字更新
          const textEl = document.getElementById('mindflow-breath-text');
          const timerEl = document.getElementById('mindflow-breath-timer');
          if (textEl && textEl.innerText !== phaseText) textEl.innerText = phaseText;
          if (timerEl) timerEl.innerText = timerText;

          // ==========================================
          // 视觉渲染核心：生物发光 (Bioluminescence)
          // ==========================================

          // 开启发光特效 (Bloom)
          p.drawingContext.shadowBlur = 60;
          p.drawingContext.shadowColor = 'rgba(149, 213, 178, 0.6)';

          // 1. 核心能量球 (Lung Core)
          // 随呼吸 pulsing
          const coreSize = 60 + (progress * 40);
          p.noStroke();
          // 内核高亮
          p.fill(220, 255, 235, 220);
          p.circle(center.x, center.y, coreSize);

          // 2. 外部光晕 (Outer Glow)
          // 使用 stroke 模拟扩散波纹，而不是填充圆，看起来更通透
          p.noFill();
          p.strokeWeight(2);

          // 动态波纹 1
          const ripple1Size = coreSize + 40 + (progress * 20);
          p.stroke(149, 213, 178, 100);
          p.circle(center.x, center.y, ripple1Size);

          // 动态波纹 2 (稍微错开节奏)
          const ripple2Size = coreSize + 80 + (progress * 60);
          p.stroke(82, 183, 136, 60);
          p.circle(center.x, center.y, ripple2Size);

          // 关闭发光特效以绘制更锐利的粒子
          p.drawingContext.shadowBlur = 0;

          // 3. 粒子系统 (Ambient Particles)
          particles.forEach(pt => {
            pt.update(progress, isInhaling, center);
            pt.draw();
          });

          // 4. 连线效果 (可选：增加生物有机感，像神经网络或菌丝)
          // 仅连接靠近中心的粒子，避免太乱
          p.strokeWeight(0.5);
          p.stroke(149, 213, 178, 20); // 极淡
          for (let i = 0; i < 20; i++) { // 只抽样部分粒子连接
            const pt = particles[i];
            if (pt.pos.dist(center) < 200) {
              p.line(center.x, center.y, pt.pos.x, pt.pos.y);
            }
          }
        };

        p.windowResized = function () {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };
      };

      this.p5Instance = new p5(sketch);
    }
  }

  // ============================================
  // 数字人头像组件 (Digital Avatar)
  // 替代原浮动按钮，6种可爱状态
  // ============================================

  class DigitalAvatar {
    constructor(onClick) {
      this.container = null;
      this.currentState = 'zen'; // 初始状态
      this.dsi = 0;
      this.onClick = onClick;
      this.init();
    }

    init() {
      this.container = document.createElement('div');
      this.container.id = 'digital-avatar';
      this.container.className = 'digital-avatar avatar-zen';
      this.container.innerHTML = this.renderSVG('zen');
      document.body.appendChild(this.container);

      // 点击触发回调 + 短暂Q弹动画
      this.container.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playPokeAnimation();
        if (this.onClick) this.onClick();
      });

      // 可拖拽
      this.makeDraggable();
    }

    // 根据DSI值返回状态名
    getStateByDSI(dsi) {
      if (dsi <= 30) return 'zen';        // 森之静谧
      if (dsi <= 50) return 'distract';   // 微风扰动
      if (dsi <= 70) return 'burnout';    // 焦糖过载
      if (dsi <= 85) return 'sleep';      // 林间小憩
      return 'healing';                    // 治愈时刻
    }

    // 更新DSI并切换状态
    updateDSI(dsi) {
      this.dsi = dsi;
      const newState = this.getStateByDSI(dsi);
      if (newState !== this.currentState) {
        this.setState(newState);
      }
    }

    // 播放Q弹交互动画
    playPokeAnimation() {
      this.container.classList.add('avatar-poke');
      setTimeout(() => {
        this.container.classList.remove('avatar-poke');
      }, 400);
    }

    setState(stateName) {
      this.currentState = stateName;
      this.container.innerHTML = this.renderSVG(stateName);
      this.container.className = `digital-avatar avatar-${stateName}`;
    }

    renderSVG(state) {
      let bodyColor = '#F8FAF7';  // 默认森林白
      let face = '';
      let extras = '';
      let sproutColor = '#81C784';

      switch (state) {
        case 'zen': // 森之静谧 - 闭眼微笑
          bodyColor = '#F8FAF7';
          face = `
            <path d="M19 34 Q23 30 27 34" fill="none" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M33 34 Q37 30 41 34" fill="none" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M26 40 Q30 44 34 40" fill="none" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
          `;
          extras = `
            <path class="wind-line" d="M48 27 Q52 24 56 27" fill="none" stroke="#A5D6A7" stroke-width="1"/>
            <path class="wind-line" d="M50 32 Q54 29 58 32" fill="none" stroke="#A5D6A7" stroke-width="1"/>
          `;
          break;

        case 'distract': // 微风扰动 - 斜眼
          bodyColor = '#E8F5E9';
          face = `
            <circle cx="22" cy="34" r="3" fill="white" stroke="#5d4037" stroke-width="1"/>
            <circle cx="24" cy="34" r="1.2" fill="#333"/>
            <circle cx="38" cy="34" r="3" fill="white" stroke="#5d4037" stroke-width="1"/>
            <circle cx="40" cy="34" r="1.2" fill="#333"/>
            <path d="M27 42 L33 42" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M19 30 L25 30" stroke="#5d4037" stroke-width="1"/>
          `;
          break;

        case 'burnout': // 焦糖过载 - 螺旋眼+抖动
          bodyColor = '#E6CCB2';
          sproutColor = '#8D6E63';
          face = `
            <path d="M19 34 C19 30, 27 30, 27 34 C27 38, 19 38, 21 34" stroke="#3e2723" stroke-width="1" fill="none"/>
            <path d="M33 34 C33 30, 41 30, 41 34 C41 38, 33 38, 35 34" stroke="#3e2723" stroke-width="1" fill="none"/>
            <path d="M24 45 Q27 42 30 45 Q33 48 36 45" stroke="#3e2723" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          `;
          extras = `
            <path d="M14 28 L12 24 M12 30 L10 26" stroke="#3e2723" stroke-width="1"/>
            <path d="M46 28 L48 24 M48 30 L50 26" stroke="#3e2723" stroke-width="1"/>
          `;
          break;

        case 'sleep': // 林间小憩 - 睡眼+鼻涕泡泡
          bodyColor = '#F8FAF7';
          face = `
            <path d="M19 35 L27 35" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M33 35 L41 35" stroke="#5d4037" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M27 41 Q30 43 33 41" stroke="#5d4037" stroke-width="1" fill="none"/>
          `;
          extras = `
            <circle class="snot-bubble" cx="36" cy="45" r="4" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5" opacity="0.8"/>
            <text x="48" y="22" font-family="Arial" font-size="8" fill="#78909C" font-weight="bold">Zzz</text>
          `;
          break;

        case 'healing': // 治愈时刻 - 发光
          bodyColor = '#A5D6A7';
          sproutColor = '#66BB6A';
          face = `
            <path d="M19 34 Q23 36 27 34" stroke="#1B5E20" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <path d="M33 34 Q37 36 41 34" stroke="#1B5E20" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <path d="M27 41 Q30 43 33 41" stroke="#1B5E20" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          `;
          extras = `
            <circle class="glow-particle" cx="12" cy="50" r="2" fill="#FFF9C4" opacity="0.8"/>
            <circle class="glow-particle" cx="52" cy="20" r="2.5" fill="#FFF9C4" opacity="0.8"/>
            <circle class="glow-particle" cx="48" cy="55" r="1.5" fill="#FFF9C4" opacity="0.8"/>
            <circle class="glow-particle" cx="8" cy="28" r="2" fill="#FFF9C4" opacity="0.8"/>
          `;
          break;

        default: // poke等
          bodyColor = '#FFF';
          face = `
            <path d="M19 32 L23 35 L19 38" stroke="#5d4037" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M41 32 L37 35 L41 38" stroke="#5d4037" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="30" cy="44" r="3" fill="#FF8A80" stroke="#5d4037" stroke-width="1"/>
          `;
      }

      // 腮红
      const cheeks = `
        <ellipse cx="17" cy="38" rx="3" ry="1.5" fill="#FFCDD2" opacity="0.6"/>
        <ellipse cx="43" cy="38" rx="3" ry="1.5" fill="#FFCDD2" opacity="0.6"/>
      `;

      // 头顶嫩芽
      const sprout = `
        <path class="avatar-sprout" d="M30 16 Q25 6 18 10 Q25 15 30 16" fill="${sproutColor}" stroke="#5d4037" stroke-width="0.8"/>
        <path class="avatar-sprout" d="M30 16 Q35 6 42 10 Q35 15 30 16" fill="${sproutColor}" stroke="#5d4037" stroke-width="0.8"/>
        <path d="M30 16 L30 20" stroke="#5d4037" stroke-width="1"/>
      `;

      return `
        <svg viewBox="0 0 60 65" class="avatar-svg">
          <!-- 身体 -->
          <ellipse class="avatar-body" cx="30" cy="38" rx="22" ry="18" fill="${bodyColor}" stroke="#5d4037" stroke-width="1.5"/>
          ${sprout}
          ${cheeks}
          ${face}
          ${extras}
        </svg>
      `;
    }

    makeDraggable() {
      let isDragging = false;
      let startX, startY, startLeft, startTop;

      this.container.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = this.container.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        this.container.style.transition = 'none';
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // 限制在视口内
        newLeft = Math.max(10, Math.min(window.innerWidth - 90, newLeft));
        newTop = Math.max(10, Math.min(window.innerHeight - 90, newTop));

        this.container.style.left = newLeft + 'px';
        this.container.style.top = newTop + 'px';
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          this.container.style.transition = '';
          // 保存位置
          localStorage.setItem('mindflow-avatar-left', this.container.style.left);
          localStorage.setItem('mindflow-avatar-top', this.container.style.top);
        }
      });

      // 恢复上次位置
      const savedLeft = localStorage.getItem('mindflow-avatar-left');
      const savedTop = localStorage.getItem('mindflow-avatar-top');
      if (savedLeft && savedTop) {
        this.container.style.left = savedLeft;
        this.container.style.top = savedTop;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      }
    }
  }

  // ============================================
  // 状态气泡弹窗 (Status Bubble)
  // 毛玻璃质感，显示DSI+语录+调试入口
  // ============================================

  class StatusBubble {
    constructor(getSidebar) {
      this.bubble = null;
      this.getSidebar = getSidebar; // 获取侧边栏实例的回调
      this.isVisible = false;
    }

    toggle(dsi) {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show(dsi);
      }
    }

    show(dsi) {
      if (!this.bubble) this.create();

      // 更新内容
      const quote = getRandomQuote(dsi);
      const statusText = this.getStatusText(dsi);
      const statusEmoji = this.getStatusEmoji(dsi);

      const dsiEl = document.getElementById('bubble-dsi');
      const statusEl = document.getElementById('bubble-status');
      const quoteEl = document.getElementById('bubble-quote');

      if (dsiEl) dsiEl.textContent = Math.round(dsi);
      if (statusEl) statusEl.textContent = `${statusEmoji} ${statusText}`;
      if (quoteEl) quoteEl.textContent = quote;

      // 根据DSI设置颜色主题
      this.bubble.className = `status-bubble status-bubble-${this.getTheme(dsi)}`;

      requestAnimationFrame(() => {
        this.bubble.classList.add('visible');
      });
      this.isVisible = true;
    }

    hide() {
      if (this.bubble) {
        this.bubble.classList.remove('visible');
        this.isVisible = false;
      }
    }

    create() {
      this.bubble = document.createElement('div');
      this.bubble.id = 'status-bubble';
      this.bubble.className = 'status-bubble';
      this.bubble.innerHTML = `
        <div class="bubble-header">
          <span class="bubble-dsi" id="bubble-dsi">0</span>
          <span class="bubble-status" id="bubble-status">😊 状态良好</span>
        </div>
        <div class="bubble-quote" id="bubble-quote">
          ✨ 点击查看今日治愈语录~
        </div>
        <div class="bubble-footer">
          <button class="bubble-debug-btn" id="bubble-debug-btn">
            🛠️ 调试控制台
          </button>
        </div>
      `;
      document.body.appendChild(this.bubble);

      // 调试按钮 -> 展开侧边栏
      document.getElementById('bubble-debug-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
        const sidebar = this.getSidebar();
        if (sidebar) sidebar.show();
      });

      // 点击气泡外部关闭
      document.addEventListener('click', (e) => {
        if (this.isVisible && !this.bubble.contains(e.target)
          && !e.target.closest('#digital-avatar')) {
          this.hide();
        }
      });
    }

    getStatusText(dsi) {
      if (dsi <= 30) return '状态极佳';
      if (dsi <= 50) return '心流区间';
      if (dsi <= 70) return '压力上升';
      if (dsi <= 85) return '需要休息';
      return '高压预警';
    }

    getStatusEmoji(dsi) {
      if (dsi <= 30) return '😊';
      if (dsi <= 50) return '🌿';
      if (dsi <= 70) return '⚡';
      if (dsi <= 85) return '⚠️';
      return '🚨';
    }

    getTheme(dsi) {
      if (dsi <= 50) return 'calm';
      if (dsi <= 70) return 'warning';
      return 'alert';
    }
  }

  // ============================================
  // 侧边栏面板 (Sidebar Panel)
  // ============================================

  class SidebarPanel {
    constructor() {
      this.panel = null;
      this.digitalAvatar = null;
      this.statusBubble = null;
      this.isVisible = false;
      this.dsi = 0;
      this.level = 0;

      this.init();
    }

    init() {
      // 创建气泡弹窗（先创建，因为它需要获取侧边栏引用）
      this.statusBubble = new StatusBubble(() => this);

      // 创建数字人头像（替代原浮动按钮）
      this.digitalAvatar = new DigitalAvatar(() => {
        this.statusBubble.toggle(this.dsi);
      });

      // 创建侧边栏面板（精简版）
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
     * 更新悬浮按钮显示（现在更新数字人头像状态）
     */
    updateFloatButton() {
      // 更新数字人头像状态
      if (this.digitalAvatar) {
        this.digitalAvatar.updateDSI(this.dsi);
      }
    }

    createPanel() {
      this.panel = document.createElement('div');
      this.panel.id = 'mindflow-sidebar';
      this.panel.className = 'mindflow-sidebar mindflow-sidebar-compact';

      // 精简版侧边栏：只保留调试控制台
      this.panel.innerHTML = `
        <div class="mindflow-sidebar-header">
          <div class="mindflow-sidebar-logo">
            <span class="mindflow-logo-icon">🧘</span>
            <span class="mindflow-logo-text">MindFlow</span>
          </div>
          <button class="mindflow-sidebar-toggle" id="mindflow-sidebar-toggle" title="收起面板 (Alt+M)">×</button>
        </div>
        
        <div class="mindflow-sidebar-content">
          <!-- 🛠️ 调试控制台 -->
          <div class="mindflow-debug-card">
            <div class="mindflow-debug-title">
              <span>🛠️ 调试控制台</span>
              <span id="mindflow-debug-display" class="mindflow-debug-value">DSI: 0</span>
            </div>
            <input type="range" id="mindflow-debug-slider" class="mindflow-debug-slider" min="0" max="100" value="0">
            <div class="mindflow-debug-buttons">
              <button class="mindflow-debug-chip" data-val="0">0 (空)</button>
              <button class="mindflow-debug-chip" data-val="45">45 (心流)</button>
              <button class="mindflow-debug-chip" data-val="70">70 (阅读)</button>
              <button class="mindflow-debug-chip" data-val="90">90 (疗愈)</button>
            </div>
          </div>
          
          <!-- 🎨 氛围背景选择 -->
          <div class="mindflow-atmosphere-card">
            <div class="mindflow-atmosphere-header">
              <span class="mindflow-atmosphere-icon">🎨</span>
              <span class="mindflow-atmosphere-title">背景氛围</span>
            </div>
            <div class="mindflow-atmosphere-options" id="mindflow-atmosphere-options">
              <div class="mindflow-atmosphere-grid">
                <button class="mindflow-atmosphere-btn" data-atmosphere="forest" title="森林">🌲</button>
                <button class="mindflow-atmosphere-btn" data-atmosphere="ocean" title="海浪">🌊</button>
                <button class="mindflow-atmosphere-btn" data-atmosphere="fire" title="火焰">🔥</button>
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

      // 氛围切换功能
      this.initAtmosphereSelector();

      // 调试控制台功能
      this.initDebugControls();
    }

    /**
     * 初始化氛围切换功能
     */
    initAtmosphereSelector() {
      const atmosphereButtons = document.querySelectorAll('.mindflow-atmosphere-btn');

      // 选择氛围类型
      atmosphereButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const atmosphereType = btn.dataset.atmosphere;
          // 移除所有按钮的 active 状态
          atmosphereButtons.forEach(b => b.classList.remove('active'));
          // 添加当前按钮的 active 状态
          btn.classList.add('active');

          // 分发氛围变更事件
          const event = new CustomEvent('mindflow:atmosphere-change', {
            detail: { type: atmosphereType }
          });
          document.dispatchEvent(event);

          console.log(`[Atmosphere] 切换到 ${atmosphereType} 氛围`);
        });
      });

      // 默认选中第一个（森林）
      if (atmosphereButtons.length > 0) {
        atmosphereButtons[0].classList.add('active');
      }
    }

    /**
     * 初始化调试控制台
     */
    initDebugControls() {
      const slider = document.getElementById('mindflow-debug-slider');
      const display = document.getElementById('mindflow-debug-display');
      const chips = document.querySelectorAll('.mindflow-debug-chip');

      if (!slider || !display) return;

      // 辅助函数：发送 DSI 更新指令
      const setDSI = (val) => {
        val = parseInt(val);
        display.textContent = `DSI: ${val}`;
        slider.value = val;

        // 发送给 background.js
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({
            type: 'DEBUG_SET_DSI',
            payload: { dsi: val }
          }).catch(() => {
            // Service Worker 可能未就绪，静默忽略
          });
          console.log(`[Debug] 手动设置 DSI: ${val}`);
        }
      };

      // 1. 滑块拖动事件 (input: 实时显示数值, change: 松手后发送指令)
      slider.addEventListener('input', (e) => {
        display.textContent = `DSI: ${e.target.value}`;
      });

      slider.addEventListener('change', (e) => {
        setDSI(e.target.value);
      });

      // 2. 快捷按钮事件
      chips.forEach(btn => {
        btn.addEventListener('click', () => {
          setDSI(btn.dataset.val);
        });
      });
    }

    async updateDSI() {
      // 检查扩展上下文是否有效
      if (!chrome.runtime?.id) {
        return;
      }

      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_DSI' }).catch(() => {
          // Service Worker 可能未就绪，返回 null
          return null;
        });

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

            // 移除旧的 SVG 引用（如果存在）
            const oldSvg = dsiRingContainer.querySelector('svg');
            if (oldSvg) {
              oldSvg.remove();
            }
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

          // ✅ 新增：更新调试滑块的位置（如果存在）
          const debugSlider = document.getElementById('mindflow-debug-slider');
          const debugDisplay = document.getElementById('mindflow-debug-display');
          // 只有当侧边栏可见，且用户没有正在操作滑块时才更新，避免"抢夺"控制权
          // 这里简单处理：直接更新，因为 updateDSI 是1秒一次，用户拖动通常很快
          if (debugSlider && document.activeElement !== debugSlider) {
            debugSlider.value = Math.round(this.dsi);
            if (debugDisplay) debugDisplay.textContent = `DSI: ${Math.round(this.dsi)}`;
          }
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
        await chrome.runtime.sendMessage({ type: 'RESET_DSI' }).catch(() => {
          // Service Worker 可能未就绪，静默忽略
        });
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
      }).catch(() => { });
    }
  } catch (e) {
    // 静默忽略
  }

  console.log('[MindFlow] 初始化完成（基于心理学理论优化版）');

})();

