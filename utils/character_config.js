/**
 * 角色和服装配置
 */

/**
 * 默认角色和服装设置
 */
export const defaultCharacterSettings = {
    // 角色预设
    characterPresets: {
        "默认角色": {
            nameCN: "",
            nameEN: "",
            characterTraits: "",  // 角色特征
            facialFeatures: "",
            facialFeaturesBack: "",
            upperBodySFW: "",
            upperBodySFWBack: "",
            fullBodySFW: "",
            fullBodySFWBack: "",
            upperBodyNSFW: "",
            upperBodyNSFWBack: "",
            fullBodyNSFW: "",
            fullBodyNSFWBack: "",
            outfits: [],
            photoImageIds: [],  // 角色照片数组 (configDatabase ID 列表)
            selectedPhotoIndex: 0,  // 当前选中的图片索引
            photoPrompt: "",    // 角色照片生成提示词
            sendPhoto: false,   // 是否发送图片
            generationContext: "",    // 生成时的上下文
            generationWorldBook: "",  // 生成时的世界书触发
            generationVariables: {}   // 生成时使用的 getvar 变量
        }
    },
    characterPresetId: "默认角色",

    // 服装预设
    outfitPresets: {
        "默认服装": {
            nameCN: "",
            nameEN: "",
            owner: "",  // 归属人（英文名称）
            upperBody: "",
            upperBodyBack: "",
            fullBody: "",
            fullBodyBack: "",
            photoImageIds: [],  // 服装照片数组 (configDatabase ID 列表)
            selectedPhotoIndex: 0,  // 当前选中的图片索引
            photoPrompt: "",    // 服装照片生成提示词
            sendPhoto: false    // 是否发送图片
        }
    },
    outfitPresetId: "默认服装",

    // 角色启用预设
    characterEnablePresets: {
        "默认启用列表": {
            characters: []
        }
    },
    characterEnablePresetId: "默认启用列表",

    // 通用服装列表预设
    outfitEnablePresets: {
        "默认服装列表": {
            outfits: []
        }
    },
    outfitEnablePresetId: "默认服装列表",

    // 通用角色列表预设
    characterCommonPresets: {
        "默认通用角色列表": {
            characters: []
        }
    },
    characterCommonPresetId: "默认通用角色列表",

    // AI 生成设置
    characterAI: {
        model: "mistral",
        temperature: 0.8,
        systemPrompt: "你是一个专业的角色设计助手。根据用户的描述，生成详细的角色特征描述。请按照以下格式输出：\n\n基础信息：\n头部特征：\n身体特征：\n特殊特征：\n其他特征：\n\n每个部分都要详细描述。",
        lastPrompt: ""
    },

    outfitAI: {
        model: "mistral",
        temperature: 0.8,
        systemPrompt: "你是一个专业的服装设计助手。根据用户的描述，生成详细的服装配饰描述。请按照以下格式输出：\n\n头颈部装饰：\n躯干服装：\n下身服装：\n手脚配饰：\n其他配饰：\n\n每个部分都要详细描述。",
        lastPrompt: ""
    }
};

/**
 * 字段显示名称映射
 */
export const fieldLabels = {};

/**
 * 分组配置
 */
export const outfitSections = [];
