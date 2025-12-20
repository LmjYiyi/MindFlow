/**
 * MindFlow - Background Service Worker
 * 核心 DSI (Digital Stress Index) 算法与状态管理
 * 
 * ===========================================
 * 理论基础 (Theoretical Foundation)
 * ===========================================
 * 1. Yerkes-Dodson Law (耶克斯-多德森定律)
 *    - 适度压力带来最佳表现（倒U形曲线）
 *    - DSI 目标不是"清零"，而是"维稳"在心流区
 * 
 * 2. Cognitive Load Theory (认知负荷理论)
 *    - 区分"好压力"（专注）与"坏压力"（焦虑熵增）
 *    - 只拦截无序的焦虑行为
 * 
 * 3. Self-Determination Theory (自我决定论)
 *    - 尊重用户控制权，避免强制干预引发逆反心理
 * 
 * ===========================================
 * DSI 核心公式
 * ===========================================
 * DSI = (S_scroll × W1 + F_click × W2) × C_context - R_recovery
 * 
 * - C_context: 上下文系数（网页类型权重）
 * - 心流区 (40-60): 暂停压力累积
 */

// ============================================
// 状态存储
// ============================================

/**
 * 每个标签页的状态数据结构
 * @typedef {Object} TabState
 * @property {number} dsi - 当前数字压力指数 (0-100)
 * @property {number} lastActivityTime - 最后活动时间戳
 * @property {number} currentLevel - 当前干预级别 (0-3)
 * @property {number} scrollSpeed - 最近的滚动速度 (px/s)
 * @property {number} clickFrequency - 最近的点击频率 (次/s)
 * @property {boolean} isIdle - 是否处于静止状态
 * @property {number} idleStartTime - 静止开始时间
 * @property {string} pageType - 页面类型 (social/news/video/document/other)
 * @property {boolean} isDeepReading - 是否处于深度阅读状态
 * @property {number} entropyScore - 行为熵值（无序程度）
 */

/** @type {Map<number, TabState>} */
const tabStates = new Map();

// ============================================
// DSI 算法配置（基于心理学理论优化）
// ============================================

const DSI_CONFIG = {
  // ===== 行为检测阈值 =====
  SCROLL_SPEED_THRESHOLD: 1500,      // 高速滚动阈值 (px/s) - 信息焦虑指标
  SCROLL_SPEED_CHAOTIC: 3000,        // 混乱滚动阈值 (px/s) - 熵增行为
  CLICK_FREQUENCY_THRESHOLD: 3,       // 高频点击阈值 (次/s)
  CLICK_FREQUENCY_CHAOTIC: 5,         // 混乱点击阈值 (次/s) - 熵增行为
  
  // ===== DSI 增量权重 =====
  SCROLL_INCREMENT: 4,                // 高速滚动 DSI 增加值
  SCROLL_CHAOTIC_INCREMENT: 8,        // 混乱滚动 DSI 增加值（熵增惩罚）
  CLICK_INCREMENT: 5,                 // 高频点击 DSI 增加值
  CLICK_CHAOTIC_INCREMENT: 10,        // 混乱点击 DSI 增加值（熵增惩罚）
  NATURAL_INCREMENT: 0.3,             // 自然累积（降低，避免误判）
  
  // ===== Yerkes-Dodson 心流区 =====
  FLOW_ZONE_MIN: 40,                  // 心流区下限
  FLOW_ZONE_MAX: 60,                  // 心流区上限
  // 在心流区内，不进行自然累积，保护专注状态
  
  // ===== 衰减规则 =====
  IDLE_THRESHOLD: 8000,               // 静止判定阈值 (8秒)
  IDLE_DECAY: 1.5,                    // 静止衰减（降低，更平滑）
  DEEP_READING_THRESHOLD: 15000,      // 深度阅读判定阈值 (15秒静止)
  
  // ===== 上下文系数 (C_context) =====
  CONTEXT_WEIGHTS: {
    'social': 1.3,       // 社交媒体 - 焦虑重灾区
    'news': 1.2,         // 资讯流 - 信息过载
    'video': 0.6,        // 视频 - 降低敏感度
    'document': 0.5,     // 文档 - 工作/学习场景
    'shopping': 1.1,     // 购物 - 决策疲劳
    'other': 1.0         // 默认
  },
  
  // ===== 分级阈值（渐进式干预）=====
  LEVEL_1_THRESHOLD: 35,              // 柔和模式 - 轻微护眼
  LEVEL_1_SUGGEST: 50,                // 柔和模式建议提示
  LEVEL_2_THRESHOLD: 65,              // 阅读模式建议
  LEVEL_2_SUGGEST: 72,                // 阅读模式强烈建议
  LEVEL_3_THRESHOLD: 85,              // 视觉疗愈触发
  
  // ===== 限制 =====
  MAX_DSI: 100,
  MIN_DSI: 0,
  
  // ===== 更新间隔 =====
  UPDATE_INTERVAL: 1000
};

// 社交媒体域名关键词（用于上下文判断）
const SOCIAL_DOMAINS = ['twitter', 'facebook', 'instagram', 'tiktok', 'weibo', 'douyin', 'xiaohongshu', 'zhihu', 'bilibili'];
const NEWS_DOMAINS = ['news', 'toutiao', 'sina', 'sohu', 'netease', '163', 'qq.com/news'];
const VIDEO_DOMAINS = ['youtube', 'netflix', 'youku', 'iqiyi', 'bilibili', 'twitch'];
const DOC_DOMAINS = ['docs.google', 'notion', 'github', 'stackoverflow', 'wikipedia', 'mdn'];

// ============================================
// 核心 DSI 算法
// ============================================

/**
 * 初始化标签页状态
 * @param {number} tabId - 标签页ID
 * @returns {TabState}
 */
function initTabState(tabId) {
  const state = {
    dsi: 0,
    lastActivityTime: Date.now(),
    currentLevel: 0,
    scrollSpeed: 0,
    clickFrequency: 0,
    isIdle: false,
    idleStartTime: null,
    pageType: 'other',           // 页面类型
    isDeepReading: false,        // 深度阅读状态
    entropyScore: 0,             // 行为熵值
    contextCoefficient: 1.0,     // 上下文系数
    suggestionShown: false       // 是否已显示建议
  };
  tabStates.set(tabId, state);
  return state;
}

/**
 * 检测页面类型（用于上下文系数）
 * @param {string} url - 页面URL
 * @returns {string} 页面类型
 */
function detectPageType(url) {
  if (!url) return 'other';
  const lowerUrl = url.toLowerCase();
  
  if (SOCIAL_DOMAINS.some(d => lowerUrl.includes(d))) return 'social';
  if (NEWS_DOMAINS.some(d => lowerUrl.includes(d))) return 'news';
  if (VIDEO_DOMAINS.some(d => lowerUrl.includes(d))) return 'video';
  if (DOC_DOMAINS.some(d => lowerUrl.includes(d))) return 'document';
  if (lowerUrl.includes('shop') || lowerUrl.includes('taobao') || lowerUrl.includes('jd.com')) return 'shopping';
  
  return 'other';
}

/**
 * 获取上下文系数
 * @param {string} pageType 
 * @returns {number}
 */
function getContextCoefficient(pageType) {
  return DSI_CONFIG.CONTEXT_WEIGHTS[pageType] || 1.0;
}

/**
 * 获取标签页状态，不存在则初始化
 * @param {number} tabId
 * @returns {TabState}
 */
function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    return initTabState(tabId);
  }
  return tabStates.get(tabId);
}

/**
 * 计算行为熵值（判断行为是否无序/焦虑）
 * 高熵值 = 混乱的、无目的的行为模式
 * @param {TabState} state
 * @returns {number} 0-1 的熵值
 */
function calculateEntropyScore(state) {
  let entropy = 0;
  
  // 极高速滚动 = 高熵（无目的浏览）
  if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_CHAOTIC) {
    entropy += 0.4;
  } else if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_THRESHOLD) {
    entropy += 0.2;
  }
  
  // 极高频点击 = 高熵（焦躁操作）
  if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_CHAOTIC) {
    entropy += 0.4;
  } else if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_THRESHOLD) {
    entropy += 0.2;
  }
  
  return Math.min(1, entropy);
}

/**
 * 判断是否处于心流区（Yerkes-Dodson 最佳唤醒区间）
 * @param {number} dsi
 * @returns {boolean}
 */
function isInFlowZone(dsi) {
  return dsi >= DSI_CONFIG.FLOW_ZONE_MIN && dsi <= DSI_CONFIG.FLOW_ZONE_MAX;
}

/**
 * 计算 DSI 增量（核心算法 - 基于心理学理论优化）
 * 
 * 核心公式: DSI = (S_scroll × W1 + F_click × W2) × C_context - R_recovery
 * 
 * @param {TabState} state - 当前标签页状态
 * @returns {number} - DSI 变化值（可正可负）
 */
function calculateDSIDelta(state) {
  let delta = 0;
  const now = Date.now();
  
  // 检查是否有实际活动
  const hasActivity = state.scrollSpeed > 0 || state.clickFrequency > 0;
  const timeSinceLastActivity = now - state.lastActivityTime;
  
  // 计算行为熵值（区分"好压力"和"坏压力"）
  state.entropyScore = calculateEntropyScore(state);
  const hasChaoticBehavior = state.entropyScore > 0.3;
  
  // 获取上下文系数
  const contextCoeff = state.contextCoefficient || 1.0;
  
  // ===== 核心逻辑：基于 Yerkes-Dodson 定律 =====
  
  if (hasActivity) {
    // 判断是否在心流区
    const inFlowZone = isInFlowZone(state.dsi);
    
    if (inFlowZone && !hasChaoticBehavior) {
      // 【心流保护】在心流区且行为有序，不增加压力
      // 这是用户专注状态，应该保护而不是干扰
      console.log(`[DSI] 心流区保护中 (DSI: ${state.dsi.toFixed(1)}, 熵: ${state.entropyScore.toFixed(2)})`);
      delta = 0;
    } else {
      // 【压力累积】只对"熵增行为"进行惩罚
      
      // 滚动压力计算
      if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_CHAOTIC) {
        // 混乱滚动 - 高惩罚
        delta += DSI_CONFIG.SCROLL_CHAOTIC_INCREMENT * contextCoeff;
        console.log(`[DSI] ⚠️ 混乱滚动: ${state.scrollSpeed.toFixed(0)}px/s, +${(DSI_CONFIG.SCROLL_CHAOTIC_INCREMENT * contextCoeff).toFixed(1)}`);
      } else if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_THRESHOLD) {
        // 高速滚动 - 普通惩罚
        delta += DSI_CONFIG.SCROLL_INCREMENT * contextCoeff;
      }
      
      // 点击压力计算
      if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_CHAOTIC) {
        // 混乱点击 - 高惩罚
        delta += DSI_CONFIG.CLICK_CHAOTIC_INCREMENT * contextCoeff;
        console.log(`[DSI] ⚠️ 混乱点击: ${state.clickFrequency.toFixed(1)}次/s, +${(DSI_CONFIG.CLICK_CHAOTIC_INCREMENT * contextCoeff).toFixed(1)}`);
      } else if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_THRESHOLD) {
        // 高频点击 - 普通惩罚
        delta += DSI_CONFIG.CLICK_INCREMENT * contextCoeff;
      }
      
      // 自然累积（仅在非心流区）
      if (!inFlowZone) {
        delta += DSI_CONFIG.NATURAL_INCREMENT;
      }
    }
    
    // 有活动时退出静止/深度阅读状态
    if (state.isIdle || state.isDeepReading) {
      state.isIdle = false;
      state.isDeepReading = false;
      state.idleStartTime = null;
    }
    
  } else {
    // ===== 无活动状态判断 =====
    
    // 判断静止时长
    const isShortIdle = timeSinceLastActivity > DSI_CONFIG.IDLE_THRESHOLD;
    const isLongIdle = timeSinceLastActivity > DSI_CONFIG.DEEP_READING_THRESHOLD;
    
    if (isLongIdle) {
      // 【深度阅读/发呆判断】
      // 长时间静止 - 可能是深度阅读，DSI 保持不变（Hold）
      if (!state.isDeepReading) {
        state.isDeepReading = true;
        console.log('[DSI] 📖 进入深度阅读/静止状态，DSI 暂停变化');
      }
      // DSI 保持不变，不增不减
      delta = 0;
      
    } else if (isShortIdle) {
      // 【短暂静止】开始缓慢衰减
      if (!state.isIdle) {
        state.isIdle = true;
        state.idleStartTime = now;
        console.log('[DSI] 😌 进入静止状态，开始缓慢恢复');
      }
      // 温和衰减
      delta = -DSI_CONFIG.IDLE_DECAY;
      
    } else {
      // 还未到静止阈值，保持不变
      delta = 0;
    }
  }
  
  return delta;
}

/**
 * 更新 DSI 值并检查干预级别
 * 采用渐进式干预策略，尊重用户控制权
 * @param {number} tabId
 */
async function updateDSI(tabId) {
  const state = getTabState(tabId);
  
  // 计算 DSI 变化量
  const delta = calculateDSIDelta(state);
  
  // 更新 DSI（限制在 0-100 范围内）
  state.dsi = Math.max(
    DSI_CONFIG.MIN_DSI,
    Math.min(DSI_CONFIG.MAX_DSI, state.dsi + delta)
  );
  
  // ===== 渐进式干预判断（基于自我决定论）=====
  
  let newLevel = 0;
  let suggestion = null;  // 建议类型
  
  // Level 3: 视觉疗愈（高阈值，用户可跳过）
  if (state.dsi > DSI_CONFIG.LEVEL_3_THRESHOLD) {
    newLevel = 3;
  }
  // Level 2: 阅读模式建议
  else if (state.dsi > DSI_CONFIG.LEVEL_2_SUGGEST) {
    newLevel = 2;
    suggestion = 'strong';  // 强烈建议
  }
  else if (state.dsi > DSI_CONFIG.LEVEL_2_THRESHOLD) {
    newLevel = 1;  // 保持 Level 1，但发送 Level 2 建议
    suggestion = 'gentle';  // 温和建议
  }
  // Level 1: 柔和模式
  else if (state.dsi > DSI_CONFIG.LEVEL_1_SUGGEST) {
    newLevel = 1;
  }
  else if (state.dsi > DSI_CONFIG.LEVEL_1_THRESHOLD) {
    newLevel = 1;
  }
  
  // 级别变化或达到建议阈值时触发
  if (newLevel !== state.currentLevel) {
    console.log(`[DSI] 级别变化: ${state.currentLevel} -> ${newLevel}, DSI: ${state.dsi.toFixed(1)}`);
    state.currentLevel = newLevel;
    await triggerIntervention(tabId, newLevel, state.dsi, suggestion);
  }
  // 发送建议提示（不改变级别）
  else if (suggestion && !state.suggestionShown) {
    await sendSuggestion(tabId, state.dsi, suggestion);
    state.suggestionShown = true;
  }
  
  // DSI 降低时重置建议状态
  if (state.dsi < DSI_CONFIG.LEVEL_2_THRESHOLD) {
    state.suggestionShown = false;
  }
  
  // 重置行为数据（等待下一秒的新数据）
  state.scrollSpeed = 0;
  state.clickFrequency = 0;
  
  // 持久化存储
  await chrome.storage.local.set({
    [`dsi_${tabId}`]: state.dsi,
    [`level_${tabId}`]: state.currentLevel,
    [`entropy_${tabId}`]: state.entropyScore,
    [`inFlow_${tabId}`]: isInFlowZone(state.dsi)
  });
  
  // 更新扩展图标徽章（使用莫兰迪自然色系）
  try {
    await chrome.action.setBadgeText({
      text: Math.round(state.dsi).toString(),
      tabId: tabId
    });
    
    // 莫兰迪自然疗愈色系
    const colors = {
      0: '#2D6A4F',  // 森林绿 - 正常
      1: '#95D5B2',  // 鼠尾草绿 - 柔和模式
      2: '#B07D62',  // 大地棕 - 阅读模式
      3: '#8B4513'   // 深棕 - 视觉疗愈
    };
    await chrome.action.setBadgeBackgroundColor({
      color: colors[newLevel],
      tabId: tabId
    });
  } catch (e) {
    // 标签页可能已关闭
  }
}

/**
 * 发送建议提示（不强制干预，尊重用户选择权）
 */
async function sendSuggestion(tabId, dsi, suggestionType) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SUGGESTION',
      payload: {
        dsi: dsi,
        suggestionType: suggestionType,  // 'gentle' | 'strong'
        timestamp: Date.now()
      }
    });
    console.log(`[Suggestion] 发送 ${suggestionType} 建议到标签页 ${tabId}`);
  } catch (error) {
    // 静默忽略
  }
}

/**
 * 触发干预指令
 * @param {number} tabId - 标签页ID
 * @param {number} level - 干预级别 (0-3)
 * @param {number} dsi - 当前 DSI 值
 * @param {string|null} suggestion - 建议类型
 */
async function triggerIntervention(tabId, level, dsi, suggestion = null) {
  const state = getTabState(tabId);
  
  try {
    // 向 content.js 发送干预指令
    await chrome.tabs.sendMessage(tabId, {
      type: 'INTERVENTION',
      payload: {
        level: level,
        dsi: dsi,
        suggestion: suggestion,
        entropyScore: state.entropyScore,
        isInFlowZone: isInFlowZone(dsi),
        pageType: state.pageType,
        timestamp: Date.now()
      }
    });
    
    console.log(`[Intervention] 已发送 Level ${level} 干预指令到标签页 ${tabId}`);
  } catch (error) {
    console.error('[Intervention] 发送干预指令失败:', error);
  }
}

// ============================================
// 消息处理
// ============================================

/**
 * 处理来自 content.js 的行为数据消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  if (!tabId) {
    sendResponse({ success: false, error: 'No tab ID' });
    return;
  }
  
  switch (message.type) {
    case 'BEHAVIOR_DATA':
      // 接收行为数据并更新状态
      handleBehaviorData(tabId, message.payload);
      sendResponse({ success: true });
      break;
      
    case 'GET_DSI':
      // 返回当前 DSI 状态（包含心理学指标）
      const state = getTabState(tabId);
      sendResponse({
        success: true,
        data: {
          dsi: state.dsi,
          level: state.currentLevel,
          isIdle: state.isIdle,
          isDeepReading: state.isDeepReading,
          entropyScore: state.entropyScore,
          isInFlowZone: isInFlowZone(state.dsi),
          pageType: state.pageType,
          contextCoefficient: state.contextCoefficient
        }
      });
      break;
      
    case 'RESET_DSI':
      // 重置 DSI（用于测试或用户手动重置）
      initTabState(tabId);
      sendResponse({ success: true });
      break;
      
    case 'CONTENT_READY':
      // content.js 已加载就绪，接收页面信息
      console.log(`[Background] Content script ready in tab ${tabId}`);
      const newState = initTabState(tabId);
      
      // 检测页面类型并设置上下文系数
      if (message.payload?.url) {
        newState.pageType = detectPageType(message.payload.url);
        newState.contextCoefficient = getContextCoefficient(newState.pageType);
        console.log(`[Background] 页面类型: ${newState.pageType}, 上下文系数: ${newState.contextCoefficient}`);
      }
      
      sendResponse({ success: true });
      break;
      
    case 'PAGE_INFO':
      // 更新页面信息
      const pageState = getTabState(tabId);
      if (message.payload?.url) {
        pageState.pageType = detectPageType(message.payload.url);
        pageState.contextCoefficient = getContextCoefficient(pageState.pageType);
      }
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  
  // 返回 true 表示异步响应
  return true;
});

/**
 * 处理行为数据
 * @param {number} tabId
 * @param {Object} data - 行为数据
 */
function handleBehaviorData(tabId, data) {
  const state = getTabState(tabId);
  
  // 更新滚动速度
  if (data.scrollSpeed !== undefined) {
    state.scrollSpeed = Math.max(state.scrollSpeed, data.scrollSpeed);
  }
  
  // 更新点击频率
  if (data.clickFrequency !== undefined) {
    state.clickFrequency = Math.max(state.clickFrequency, data.clickFrequency);
  }
  
  // 更新页面类型（如果有）
  if (data.pageType) {
    state.pageType = data.pageType;
    state.contextCoefficient = getContextCoefficient(data.pageType);
  }
  
  // 更新最后活动时间
  state.lastActivityTime = Date.now();
}

// ============================================
// 定时器管理
// ============================================

/** @type {Map<number, number>} tabId -> intervalId */
const updateIntervals = new Map();

/**
 * 为标签页启动 DSI 更新定时器
 * @param {number} tabId
 */
function startDSITimer(tabId) {
  // 避免重复启动
  if (updateIntervals.has(tabId)) {
    return;
  }
  
  // 初始化状态
  initTabState(tabId);
  
  // 每秒更新 DSI
  const intervalId = setInterval(() => {
    updateDSI(tabId);
  }, DSI_CONFIG.UPDATE_INTERVAL);
  
  updateIntervals.set(tabId, intervalId);
  console.log(`[Timer] 已为标签页 ${tabId} 启动 DSI 定时器`);
}

/**
 * 停止标签页的 DSI 更新定时器
 * @param {number} tabId
 */
function stopDSITimer(tabId) {
  const intervalId = updateIntervals.get(tabId);
  if (intervalId) {
    clearInterval(intervalId);
    updateIntervals.delete(tabId);
    console.log(`[Timer] 已停止标签页 ${tabId} 的 DSI 定时器`);
  }
}

// ============================================
// 标签页生命周期监听
// ============================================

// 标签页更新时（包括加载完成）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    startDSITimer(tabId);
  }
});

// 标签页激活时
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('chrome://')) {
      startDSITimer(tabId);
    }
  } catch (e) {
    // 标签页可能已不存在
  }
});

// 标签页关闭时清理资源
chrome.tabs.onRemoved.addListener((tabId) => {
  stopDSITimer(tabId);
  tabStates.delete(tabId);
  
  // 清理存储
  chrome.storage.local.remove([`dsi_${tabId}`, `level_${tabId}`]);
  console.log(`[Cleanup] 已清理标签页 ${tabId} 的资源`);
});

// ============================================
// Service Worker 保活机制
// ============================================

// MV3 Service Worker 会在空闲时被终止，使用 alarm 保活
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('[KeepAlive] Service Worker 心跳');
  }
});

// 初始化日志
console.log('[MindFlow] Background Service Worker 已启动');

