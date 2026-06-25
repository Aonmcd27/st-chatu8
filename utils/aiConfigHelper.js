/* eslint-disable no-undef */
// @ts-nocheck

/**
 * aiConfigHelper.js — 聚合入口文件
 *
 * 此文件已拆分为多个子模块，位于 configHelper/ 目录下。
 * 本文件仅做 re-export，保持原有导出签名不变，确保外部调用者无需修改导入路径。
 */

// ==================== configDescriptions ====================
export { ConfigDescriptions, ProjectDescription } from './configHelper/configDescriptions.js';

// ==================== configValidation ====================
export {
    getExposedSettings,
    updateSettingSafely,
    getAiDiagnosticPackage,
    getDetailedConfigKeys,
    getSpecificConfigData,
    ConfigOptions,
    checkRequiredConfigs,
} from './configHelper/configValidation.js';

// ==================== configUIRefresh ====================
export { refreshAffectedUI, syncRangeInputs, refreshWorkflowSelectors } from './configHelper/configUIRefresh.js';

// ==================== configBrowseAPI ====================
export {
    browseConfigPath,
    readConfigPath,
    writeConfigPath,
    UIActionRegistry,
    executeUIAction,
    getCurrentUIContext,
} from './configHelper/configBrowseAPI.js';

// ==================== configRegexBridge ====================
export {
    getRegexStatus,
    setRegexOriginalText,
    setRegexEditors,
    createRegexEntry,
    triggerRegexTest,
    setRegexTestMode,
    getRegexResultText,
    setGestureEnabled,
    setClickTriggerEnabled,
    clearAllRegexEntries,
} from './configHelper/configRegexBridge.js';

// ==================== configWorkflowBridge ====================
export {
    getWorkflowList,
    readWorkflow,
    scanWorkflowVariables,
    replaceWorkflowVariable,
    saveWorkflow,
    listWorkflowNodes,
    readWorkflowNode,
    updateWorkflowNodeInput,
    batchUpdateWorkflowNodes,
    deleteWorkflowNode,
    addWorkflowNode,
} from './configHelper/configWorkflowBridge.js';
