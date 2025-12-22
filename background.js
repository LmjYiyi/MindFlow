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
// 导入配置文件
// ============================================
try {
  importScripts('config.js');
} catch (e) {
  console.error('[MindFlow] 无法加载配置文件 config.js，请确保文件存在');
  console.error('[MindFlow] 错误详情:', e);
}

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
 * @property {number} directionChanges - 往复滚动次数
 * @property {number} rageClickCount - 暴躁点击次数
 * @property {boolean} isIdle - 是否处于静止状态
 * @property {number} idleStartTime - 静止开始时间
 * @property {string} pageType - 页面类型 (social/news/video/document/other)
 * @property {boolean} isDeepReading - 是否处于深度阅读状态 ( passively detected idle on document/news)
 * @property {boolean} isReaderModeActive - **[新增]** 是否处于阅读模式 (actively triggered)
 * @property {boolean} isTherapyActive - 是否处于主动疗愈状态 (Level 3)
 * @property {number} entropyScore - 行为熵值（无序程度）
 * @property {number} contextCoefficient - 上下文系数
 * @property {boolean} suggestionShown - 是否已显示建议
 */

/** @type {Map<number, TabState>} */
const tabStates = new Map();

// ============================================
// DSI 算法配置（基于心理学理论优化）
// ============================================

const DSI_CONFIG = {
  // ===== 行为检测阈值 (放宽阈值，减少误判) =====
  SCROLL_SPEED_THRESHOLD: 2000,      // [上调] 从 1500 改为 2000，减少误判
  SCROLL_SPEED_CHAOTIC: 3000,        // 混乱滚动阈值 (px/s) - 熵增行为
  CLICK_FREQUENCY_THRESHOLD: 3,       // 高频点击阈值 (次/s)
  CLICK_FREQUENCY_CHAOTIC: 5,         // 混乱点击阈值 (次/s) - 熵增行为
  DIRECTION_CHANGE_CHAOTIC: 2,        // 往复滚动阈值 (次/s) - 典型的焦虑特征
  RAGE_CLICK_THRESHOLD: 2,            // 暴躁点击阈值 (次/s) - 典型的愤怒特征

  // ===== DSI 增量权重 (大幅降低惩罚，提高恢复) =====
  SCROLL_INCREMENT: 1.5,             // [大幅下调] 从 4 改为 1.5 (快速浏览不应重罚)
  SCROLL_CHAOTIC_INCREMENT: 5,       // [下调] 从 10 改为 5 (给用户改正机会)
  CLICK_INCREMENT: 2,                // [下调] 从 5 改为 2
  CLICK_CHAOTIC_INCREMENT: 8,        // [下调] 从 15 改为 8
  NATURAL_INCREMENT: 0.0,             // 默认无序的自然累积设为 0
  FLOW_RECOVERY: 1.0,                 // [微调] 心流状态下的主动恢复值

  // [新增] 活跃恢复基准：正常浏览时的回血速度
  ACTIVE_RECOVERY_BASE: 0.5,         // 正常浏览时的恢复速度（每秒 -0.5）

  // ===== Yerkes-Dodson 心流区 =====
  FLOW_ZONE_MIN: 40,                  // 心流区下限
  FLOW_ZONE_MAX: 60,                  // 心流区上限
  // 在心流区内，不进行自然累积，保护专注状态

  // ===== 衰减规则优化 =====
  DECAY_DELAY: 2500,                  // **[修改]** 潜伏期稍长，给用户更多喘息机会。
  IDLE_THRESHOLD: 5000,               // 静止阈值同步调整
  DEEP_READING_THRESHOLD: 10000,      // 10秒静止即视为深度阅读
  READER_MODE_DECAY_RATE: 1.0,        // **[新增]** 阅读模式下的每秒衰减值

  // 指数衰减模型（药物动力学/半衰期模型）
  DECAY_BASE_RATE: 0.6,               // **[修改]** 自然衰减基础速率 (每秒 -0.6)
  DECAY_FACTOR: 0.05,                 // 指数衰减因子 (DSI越大减得越快)
  THERAPY_BONUS: 3.0,                 // 疗愈模式下的额外衰减倍率
  MIN_BASELINE: 0,                    // 允许归零

  // 页面类型衰减系数（白名单/黑名单机制）
  DECAY_MULTIPLIERS: {
    'video': 0.5,                     // 视频网站：被动娱乐，衰减减半
    'document': 0.3,                  // [修复] 从 0.0 改为 0.3，允许文档页缓慢回血
    'shopping': 0.8,                  // [新增] 购物页即使停下来也在思考，衰减稍慢
    'other': 1.0                      // 默认衰减率
  },

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
    isTherapyActive: false,           // 是否处于主动疗愈状态
    isReaderModeActive: false,        // **[新增]** 是否处于阅读模式
    currentLevel: 0,
    scrollSpeed: 0,
    clickFrequency: 0,
    directionChanges: 0,         // 往复滚动次数
    rageClickCount: 0,           // 暴躁点击次数
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

  // 1. 往复滚动 (Yo-yo Effect) - 极高权重的焦虑指标
  if (state.directionChanges > DSI_CONFIG.DIRECTION_CHANGE_CHAOTIC) {
    entropy += 0.5;
  }

  // 2. 暴躁点击 (Rage Clicks) - 极高权重的愤怒指标
  if (state.rageClickCount > DSI_CONFIG.RAGE_CLICK_THRESHOLD) {
    entropy += 0.5;
  }

  // 3. 极自速滚动 - 中等权重的焦虑指标
  if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_CHAOTIC) {
    entropy += 0.3;
  } else if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_THRESHOLD) {
    entropy += 0.1;
  }

  // 4. 高频点击
  if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_CHAOTIC) {
    entropy += 0.3;
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
/**
 * 优化版 DSI 变化计算
 * 强化干预奖励机制，修复阅读模式逻辑
 */
function calculateDSIDelta(state) {
  let delta = 0;
  const now = Date.now();
  const timeSinceLastActivity = now - state.lastActivityTime;
  const contextCoeff = state.contextCoefficient || 1.0;

  // 计算行为熵值（区分"好压力"和"坏压力"）
  state.entropyScore = calculateEntropyScore(state);

  // ===== 1. 主动疗愈 (优先级最高，最强衰减) =====
  if (state.isTherapyActive) {
    // 疗愈模式下，DSI 衰减更快
    const therapyDecay = -(DSI_CONFIG.THERAPY_BONUS + state.dsi * DSI_CONFIG.DECAY_FACTOR);
    // console.log(`[DSI] 🧘 疗愈恢复: ${therapyDecay.toFixed(2)}`);
    return therapyDecay; // 直接返回，不计算其他
  }

  // ===== 2. 阅读模式 (优先级次之，主动恢复) =====
  if (state.isReaderModeActive) {
    // 【修改点】：阅读模式下的 DSI 策略
    const READER_MODE_TARGET_MIN = 45; // 阅读模式下的 DSI 目标下限
    const READER_MODE_TARGET_MAX = 55; // 阅读模式下的 DSI 目标上限

    let baseDecay = DSI_CONFIG.DECAY_BASE_RATE * 0.3; // 衰减率大幅降低
    const pageDecayMultiplier = DSI_CONFIG.DECAY_MULTIPLIERS[state.pageType] || 1.0;
    baseDecay *= pageDecayMultiplier;

    // 1. 如果 DSI 已经处于目标区间，则视为稳定
    if (state.dsi >= READER_MODE_TARGET_MIN && state.dsi <= READER_MODE_TARGET_MAX) {
      // DSI 稳定，不增不减
      return 0;
    }
    // 2. 如果 DSI 高于目标区间，缓慢衰减
    else if (state.dsi > READER_MODE_TARGET_MAX) {
      return -baseDecay;
    }
    // 3. 如果 DSI 低于目标区间，稍微增加，拉回目标区间（防止 DSI 过低）
    else { // state.dsi < READER_MODE_TARGET_MIN
      // 允许非常微弱的 DSI 增长，将其拉回目标区间
      return 0.2; // 微弱增长，例如 +0.2
    }
  }

  // 过滤微小抖动：如果速度非常慢 (<50px/s) 且无点击，视为静止/低负荷，不判定为 Active
  const isMeaningfulActivity = state.scrollSpeed > 50 || state.clickFrequency > 0;

  // ===== 3. 活跃状态 vs 非活跃状态 判定 =====
  // 修正：不再使用早期 return，而是统一计算出 delta，最后统一应用 Level 1 地板逻辑

  if (isMeaningfulActivity) {
    // --- 活跃状态 (Active) ---
    // 退出静止状态
    if (state.isIdle || state.isDeepReading) {
      state.isIdle = false;
      state.isDeepReading = false;
    }

    const inFlowZone = isInFlowZone(state.dsi);

    // A. 混乱行为 (熵增) - 给予惩罚
    if (state.directionChanges > DSI_CONFIG.DIRECTION_CHANGE_CHAOTIC) {
      delta += DSI_CONFIG.SCROLL_CHAOTIC_INCREMENT * contextCoeff;
    } else if (state.rageClickCount > DSI_CONFIG.RAGE_CLICK_THRESHOLD) {
      delta += DSI_CONFIG.CLICK_CHAOTIC_INCREMENT * contextCoeff;
    } else if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_CHAOTIC) {
      // 只有极度混乱的滚动才给予重罚，普通快速滚动给予轻罚
      delta += DSI_CONFIG.SCROLL_INCREMENT * contextCoeff;
    } else if (state.clickFrequency > DSI_CONFIG.CLICK_FREQUENCY_THRESHOLD) {
      delta += DSI_CONFIG.CLICK_INCREMENT * contextCoeff;
    }
    // B. 正常活跃行为 (Normal Activity) - 给予恢复
    else {
      // 🚀 核心修正点：大幅提高正常浏览时的"回血"能力
      // 即使不在心流区，只要行为有序，就应该允许 DSI 下降

      let activeRecovery = DSI_CONFIG.ACTIVE_RECOVERY_BASE || 0.5;

      // 如果 DSI 很高 (>70)，加大恢复力度，帮助用户回归
      if (state.dsi > 70) {
        activeRecovery *= 1.5;
      }

      // 心流区保护：在心流区内，恢复速度适中
      if (inFlowZone) {
        delta = -DSI_CONFIG.FLOW_RECOVERY;
      } else {
        // 在心流区外（通常是过高或过低），给予明确的恢复方向
        // 这里假设大部分情况是过高，所以给予负值
        delta = -activeRecovery;
      }

      // 如果是快速但有序的滚动 (介于 Threshold 和 Chaotic 之间)，不增不减，或者微增
      if (state.scrollSpeed > DSI_CONFIG.SCROLL_SPEED_THRESHOLD && state.scrollSpeed <= DSI_CONFIG.SCROLL_SPEED_CHAOTIC) {
        delta = 0.5 * contextCoeff; // 轻微压力，而不是之前的 +4
      }
    }
  } else {
    // --- 非活跃状态 (Idle) ---

    // A. 潜伏期 (0 - DECAY_DELAY)
    if (timeSinceLastActivity < DSI_CONFIG.DECAY_DELAY) {
      delta = 0; // 缓冲期，DSI 不变
    }
    // B. 深度阅读 (文档/新闻页 > 深度阅读阈值)
    else if ((state.pageType === 'document' || state.pageType === 'news') &&
      timeSinceLastActivity > DSI_CONFIG.DEEP_READING_THRESHOLD) {
      if (!state.isDeepReading) {
        state.isDeepReading = true;
        console.log('[DSI] 📖 深度阅读中...');
      }
      delta = -0.4; // 深度阅读给予奖励性恢复
    }
    // C. 自然衰减
    else {
      let decay = DSI_CONFIG.DECAY_BASE_RATE + (state.dsi * DSI_CONFIG.DECAY_FACTOR);
      const pageDecayMultiplier = DSI_CONFIG.DECAY_MULTIPLIERS[state.pageType] || 1.0;
      decay *= pageDecayMultiplier;

      // 心流区衰减减半
      if (isInFlowZone(state.dsi)) {
        decay *= 0.5;
      }

      // 确保至少有微量衰减
      if (decay < 0.1 && decay > 0 && state.dsi > 0) decay = 0.1;

      if (!state.isIdle) {
        state.isIdle = true;
      }

      delta = -decay;
    }
  }

  // ===== 4. 全局拦截器：Level 1 护眼模式持久化 =====
  // 核心修复：无论是因为 Idle 还是 Active 导致的 DSI 下降，
  // 只要处于 Level 1，且 DSI 将跌破地板 (25)，就强制拦截。
  if (state.currentLevel === 1 && delta < 0) {
    const LEVEL_1_FLOOR = 25; // 地板值 (高于退出阈值 20)

    // 如果当前的 DSI 加上变化量 delta 会低于地板
    if (state.dsi + delta < LEVEL_1_FLOOR) {
      // 如果当前 DSI 本身就在地板之上，允许它降落到地板
      if (state.dsi > LEVEL_1_FLOOR) {
        delta = -(state.dsi - LEVEL_1_FLOOR); // 刚好降到 25
      } else {
        // 如果已经在地板或地板之下，完全停止衰减
        delta = 0;
      }
      // console.log(`[DSI] ⚓️ 护眼模式锁定中 (Floor: 25), Delta 调整为: ${delta}`);
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

  // 1. 优先检查：疗愈模式 (Level 3)
  // 如果疗愈模式正在进行中，强制锁定 Level 为 3
  // 只有当 isTherapyActive 为 false 时（倒计时结束或用户跳过），才允许降级
  if (state.isTherapyActive) {
    newLevel = 3;
    // 即使 DSI 已经降到了 0，只要动画没播完，这里依然保持 3
    // 这样就不会触发 triggerIntervention 去销毁动画了
    // 如果 currentLevel 已经是 3，就不需要再发送干预指令
    if (state.currentLevel === 3) {
      // 已经是 Level 3，不需要更新，直接跳过后续逻辑
      // 但仍然需要更新 DSI 和保存状态（上面的代码已经处理了）
      return; // 直接返回，不触发干预指令
    }
    // 如果 currentLevel 不是 3，需要触发干预（这种情况理论上不应该发生，但为了安全还是处理）
    console.log(`[DSI] 疗愈模式锁定 Level 3, DSI: ${state.dsi.toFixed(1)}`);
    state.currentLevel = newLevel;
    await triggerIntervention(tabId, newLevel, state.dsi, suggestion);
    // 注意：这里不处理 suggestion，因为疗愈模式不需要建议
    return; // 直接返回，不执行后续逻辑
  }

  // 2. 次级优先：阅读模式锁定 (Level 2)
  // ✅ [核心修复]：只要阅读模式是激活状态，强制锁定 Level 至少为 2
  // 即使 DSI 降到了 45 (心流区)，也不允许降级到 Level 1/0
  if (state.isReaderModeActive) {
    // 允许升级到 Level 3，但不允许降级
    if (state.dsi > DSI_CONFIG.LEVEL_3_THRESHOLD) {
      newLevel = 3;
    } else {
      newLevel = 2; // 🔒 强制锁定在 Level 2
    }
  }
  // 3. 标准阈值判断逻辑 (仅在非阅读模式且非疗愈模式下执行)
  else {
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
    // Level 1: 柔和模式（宽进严出策略）
    else {
      // 【修改点】：Level 1 的判断逻辑优化
      // 如果当前已经是 Level 1，则使用更低的"退出阈值"（例如 20）
      // 如果当前不是 Level 1，则使用正常的"进入阈值"（例如 35）
      const level1ExitThreshold = 20;
      const isAlreadyLevel1 = state.currentLevel === 1;

      if (state.dsi > DSI_CONFIG.LEVEL_1_THRESHOLD) {
        newLevel = 1;
      } else if (isAlreadyLevel1 && state.dsi > level1ExitThreshold) {
        // DSI 虽然低于触发值(35)，但高于退出值(20)，保持 Level 1
        newLevel = 1;
      } else {
        // 低于退出值，或者本来就没开启，设为 0
        newLevel = 0;
      }
    }
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
  state.directionChanges = 0;
  state.rageClickCount = 0;

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

  // 更新往复滚动次数
  if (data.directionChanges !== undefined) {
    state.directionChanges = data.directionChanges;
  }

  // 更新暴躁点击次数
  if (data.rageClickCount !== undefined) {
    state.rageClickCount = data.rageClickCount;
  }
}

/**
 * 处理疗愈完成
 * @param {number} tabId
 */
function handleTherapyCompletion(tabId) {
  const state = getTabState(tabId);

  // 【修复】确保 isTherapyActive 被正确置为 false
  state.isTherapyActive = false;
  console.log(`[DSI] 🧘 疗愈完成，isTherapyActive 已设置为 false`);

  // 奖励机制：将 DSI 回退到"心流区" (45)
  // 如果当前已经是低压状态，就不变
  if (state.dsi > 50) {
    console.log(`[DSI] 🧘 疗愈完成，压力值回退: ${state.dsi.toFixed(1)} -> 45.0 (进入心流区)`);
    state.dsi = 45;

    // 强制将等级降回 0 (正常) 或 1 (柔和)
    // 这样侧边栏和图标会立即变绿
    state.currentLevel = 0;

    // 立即保存状态
    chrome.storage.local.set({
      [`dsi_${tabId}`]: state.dsi,
      [`level_${tabId}`]: state.currentLevel
    });

    // 更新图标
    chrome.action.setBadgeText({ text: '45', tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#2D6A4F', tabId: tabId });
  }
}

/**
 * 处理用户主动退出阅读模式
 * @param {number} tabId
 */
async function handleReaderModeExit(tabId) {
  const state = getTabState(tabId);

  // 1. 标记阅读模式结束
  state.isReaderModeActive = false;
  console.log(`[DSI] 📖 用户主动退出阅读模式`);

  // 2. 重置 DSI 到一个"正常"的值（例如，心流区附近，但非最低）
  // 假设用户退出阅读模式是希望回归，但也不是立即进入高压状态
  const targetDsiAfterExit = 40; // 目标值
  if (state.dsi > targetDsiAfterExit) {
    state.dsi = targetDsiAfterExit;
  }
  // 如果已经很低了，就不用再提高了

  // 3. 确保当前级别正确（可能从 Level 2/3 降回 Level 1 或 0）
  // 需要重新计算一遍级别，因为 DSI 改变了
  let newLevel = 0;
  if (state.dsi > DSI_CONFIG.LEVEL_3_THRESHOLD) newLevel = 3;
  else if (state.dsi > DSI_CONFIG.LEVEL_2_THRESHOLD) newLevel = 2;
  else if (state.dsi > DSI_CONFIG.LEVEL_1_THRESHOLD) newLevel = 1;
  state.currentLevel = newLevel;

  // 4. 重新发送干预指令，确保 UI 更新
  await triggerIntervention(tabId, state.currentLevel, state.dsi, null);

  // 5. 保存状态
  await chrome.storage.local.set({
    [`dsi_${tabId}`]: state.dsi,
    [`level_${tabId}`]: state.currentLevel
  });

  // 6. 更新图标
  await chrome.action.setBadgeText({ text: Math.round(state.dsi).toString(), tabId: tabId });
  const colors = { 0: '#2D6A4F', 1: '#95D5B2', 2: '#B07D62', 3: '#8B4513' };
  await chrome.action.setBadgeBackgroundColor({ color: colors[state.currentLevel], tabId: tabId });
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

// ============================================
// LLM API 调用 (Google Gemini)
// ============================================

/**
 * 处理来自 content.js 的行为数据消息
 * 【关键修复】：移除 async 关键字，避免消息通道提前关闭
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (!tabId) {
    sendResponse({ success: false, error: 'No tab ID' });
    return false; // 同步结束
  }

  switch (message.type) {
    case 'BEHAVIOR_DATA':
      // 接收行为数据并更新状态
      handleBehaviorData(tabId, message.payload);
      sendResponse({ success: true });
      return false; // 同步任务，返回 false

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
      return false; // 同步任务，返回 false

    case 'RESET_DSI':
      // 重置 DSI（用于测试或用户手动重置）
      initTabState(tabId);
      sendResponse({ success: true });
      return false; // 同步任务，返回 false

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
      return false; // 同步任务，返回 false

    case 'PAGE_INFO':
      // 更新页面信息
      const pageState = getTabState(tabId);
      if (message.payload?.url) {
        pageState.pageType = detectPageType(message.payload.url);
        pageState.contextCoefficient = getContextCoefficient(pageState.pageType);
      }
      sendResponse({ success: true });
      return false; // 同步任务，返回 false

    case 'CALL_LLM_API':
      // 🚀 核心架构优化：在后台处理 API 请求，避免 CORS 问题
      // 【关键修复】：使用立即执行的异步函数（IIFE），确保 sendResponse 在异步操作完成后调用
      (async () => {
        let responseSent = false;
        const sendResponseSafe = (data) => {
          if (!responseSent) {
            try {
              sendResponse(data);
              responseSent = true;
            } catch (e) {
              console.error('[Background] sendResponse 失败:', e);
            }
          }
        };

        try {
          // 检查 payload
          if (!message.payload || !message.payload.text) {
            sendResponseSafe({ success: false, error: '缺少文章内容' });
            return;
          }

          console.log('[Background] 开始调用 Gemini API，文本长度:', message.payload.text.length);
          const summary = await callGeminiAPI(message.payload.text);
          console.log('[Background] API 调用成功，摘要长度:', summary.length);

          sendResponseSafe({ success: true, data: summary });
        } catch (err) {
          console.error('[Background] API 调用失败:', err);
          sendResponseSafe({ success: false, error: err.message || 'API 请求失败' });
        }
      })();
      return true; // 【关键】必须在同步代码块末尾返回 true，表示"稍后会异步发送响应"

    case 'GET_CONTEXT_GREETING':
      // 🎯 生成上下文问候语（结合页面内容和压力值）
      (async () => {
        let responseSent = false;
        const sendResponseSafe = (data) => {
          if (!responseSent) {
            try {
              sendResponse(data);
              responseSent = true;
            } catch (e) {
              console.error('[Background] sendResponse 失败:', e);
            }
          }
        };

        try {
          const { title, url, dsi } = message.payload;
          
          // 检测页面类型
          const pageType = detectPageType(url);
          
          console.log('[Background] 开始生成上下文问候，页面类型:', pageType, 'DSI:', dsi);
          const greeting = await generateContextGreeting(title, pageType, dsi);
          console.log('[Background] 上下文问候生成成功');

          sendResponseSafe({ success: true, data: greeting });
        } catch (err) {
          console.error('[Background] 生成上下文问候失败:', err);
          sendResponseSafe({ success: false, error: err.message || '生成问候失败' });
        }
      })();
      return true; // 异步操作，返回 true

    case 'THERAPY_COMPLETED':
      // 🧘 疗愈完成，执行"回退奖励"
      handleTherapyCompletion(tabId);
      sendResponse({ success: true });
      return false; // 同步任务，返回 false

    case 'THERAPY_ACTIVE':
      // 🧘 更新疗愈状态（Level 3 开启/关闭）
      const therapyState = getTabState(tabId);
      therapyState.isTherapyActive = message.payload.active || false;
      console.log(`[DSI] 🧘 疗愈状态更新: ${therapyState.isTherapyActive ? '开启' : '关闭'}`);
      sendResponse({ success: true });
      return false; // 同步任务，返回 false

    case 'READER_MODE_STATE': // **[新增]** 处理阅读模式状态
      // 【关键修复】：使用立即执行的异步函数处理异步操作
      (async () => {
        let responseSent = false;
        const sendResponseSafe = (data) => {
          if (!responseSent) {
            try {
              sendResponse(data);
              responseSent = true;
            } catch (e) {
              console.error('[Background] sendResponse 失败:', e);
            }
          }
        };

        try {
          const readerState = getTabState(tabId);
          // 【修改点】：检测是开启还是关闭
          if (message.payload.active === false) {
            // 用户主动退出
            await handleReaderModeExit(tabId); // 调用新的退出处理函数
            // readerState.isReaderModeActive = false; // handleReaderModeExit 会设置
          } else {
            // 用户主动开启
            readerState.isReaderModeActive = true;
            // 【重要】可能需要重置 DSI 到一个高 DSI 值，以确保 Level 2 被触发
            // 如果 DSI 本身就很高，这里可以不用动，否则，将其提高到 Level 2 阈值附近
            if (readerState.dsi < DSI_CONFIG.LEVEL_2_THRESHOLD) {
              readerState.dsi = DSI_CONFIG.LEVEL_2_THRESHOLD + 5; // 略高于阈值
              console.log(`[DSI] 📖 阅读模式开启，DSI 提升至 ${readerState.dsi.toFixed(1)}`);
              // 触发一次干预检查，确保 Level 2 被正确设置
              await triggerIntervention(tabId, 2, readerState.dsi, 'strong');
            }
          }
          console.log(`[DSI] 📖 阅读模式状态更新: ${readerState.isReaderModeActive ? '开启' : '关闭'}`);
          sendResponseSafe({ success: true });
        } catch (err) {
          console.error('[Background] 阅读模式状态更新失败:', err);
          sendResponseSafe({ success: false, error: err.message || '操作失败' });
        }
      })();
      return true; // 【关键】异步操作，返回 true

    // 🔧 添加调试后门：手动设置 DSI
    case 'DEBUG_SET_DSI':
      const dbgState = getTabState(tabId);
      dbgState.dsi = message.payload.dsi;
      // 强制触发一次更新检查，以便立即弹出提示
      updateDSI(tabId);
      sendResponse({ success: true, dsi: dbgState.dsi });
      return false; // 同步任务，返回 false

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return false; // 同步任务，返回 false
  }
});

// ============================================
// LLM API 调用 (Google Gemini)
// ============================================
/**
 * 调用 Google Gemini API 生成文章摘要
 * @param {string} text - 文章正文
 * @returns {Promise<string>} - 生成的摘要
 */
async function callGeminiAPI(text) {
  // 从配置文件读取 API Key
  const API_KEY = self.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';
  const MODEL = self.GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';
  
  if (API_KEY === 'YOUR_GEMINI_API_KEY_HERE' || !API_KEY) {
    throw new Error('请配置 GEMINI_API_KEY：复制 config.example.js 为 config.js 并填入你的 API key');
  }
  
  // 注意：Gemini 接口 URL 包含 API Key
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  // 检查输入文本
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('文章内容为空，无法生成摘要');
  }

  // 限制文本长度，对齐之前的逻辑
  const truncatedText = text.trim().slice(0, 3000);

  if (truncatedText.length < 50) {
    throw new Error('文章内容过短，无法生成摘要');
  }

  const prompt = `你是一个专业的文章摘要助手。请用简洁优雅的中文为用户生成文章的核心要点摘要。要求：1. 提炼3-5个关键观点；2. 每个观点用一句话概括；3. 使用emoji增强可读性；4. 总字数控制在200字以内。\n\n内容：\n\n${truncatedText}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (!response.ok) {
      let errorMessage = `Gemini API 请求失败 (${response.status})`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorData.error?.status || errorMessage;
        console.error('[Gemini API] 错误详情:', errorData);
      } catch (e) {
        errorMessage = `Gemini API 请求失败 (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    // 解析 Gemini 响应格式
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summary || summary.trim().length === 0) {
      console.error('[Gemini API] 响应数据结构:', data);
      throw new Error('Gemini 未能生成有效的摘要');
    }

    console.log('[Gemini API] 摘要生成成功，长度:', summary.length);
    return summary.trim();

  } catch (error) {
    console.error('[Gemini API] 调用失败:', error);
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('无法连接到 Google API，请检查网络（可能需要代理）');
    }
    throw error;
  }
}

/**
 * 生成上下文问候语
 * @param {string} pageTitle - 页面标题
 * @param {string} pageType - 页面类型
 * @param {number} dsi - 压力指数
 * @returns {Promise<string>} - 生成的问候语
 */
async function generateContextGreeting(pageTitle, pageType, dsi) {
  // 从配置文件读取 API Key
  const API_KEY = self.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';
  const MODEL = self.GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';
  
  if (API_KEY === 'YOUR_GEMINI_API_KEY_HERE' || !API_KEY) {
    throw new Error('请配置 GEMINI_API_KEY：复制 config.example.js 为 config.js 并填入你的 API key');
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  // 清洗页面标题（截取前50个字符）
  const cleanTitle = pageTitle ? pageTitle.trim().slice(0, 50) : '当前页面';

  // 页面类型映射
  const pageTypeMap = {
    'social': '社交',
    'news': '新闻',
    'shopping': '购物',
    'document': '文档/学习',
    'video': '视频',
    'other': '其他'
  };
  const pageTypeName = pageTypeMap[pageType] || '其他';

  // 构建 Prompt（优化版：更符合 Mindy 人设）
  const prompt = `你是一个温柔可爱的数字健康助手 Mindy。
用户正在浏览网页：
- 标题: "${cleanTitle}" 
- 类型: ${pageTypeName} (social=社交, news=新闻, shopping=购物, document=学习/工作, video=视频)
- 当前压力值(DSI): ${dsi} (0-100，越高越焦虑)

请根据当前网页内容和压力状态，主动对用户说一句简短的关怀语（20字以内）。
要求：
1. 必须结合网页场景（例如：购物时提醒理性，看文档时鼓励专注，刷视频时提醒休息）。
2. 语气像朋友一样轻松自然，可以使用1个emoji。
3. 不要说教，要提供情绪价值。
4. 直接输出内容，不要包含引号。`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (!response.ok) {
      let errorMessage = `Gemini API 请求失败 (${response.status})`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorData.error?.status || errorMessage;
        console.error('[Gemini API] 错误详情:', errorData);
      } catch (e) {
        errorMessage = `Gemini API 请求失败 (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const greeting = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!greeting || greeting.trim().length === 0) {
      console.error('[Gemini API] 响应数据结构:', data);
      throw new Error('Gemini 未能生成有效的问候语');
    }

    console.log('[Gemini API] 上下文问候生成成功');
    return greeting.trim();
  } catch (error) {
    console.error('[Gemini API] 上下文问候生成失败:', error);
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('无法连接到 Google API，请检查网络（可能需要代理）');
    }
    throw error;
  }
}

// 初始化日志
console.log('[MindFlow] Background Service Worker 已启动');

