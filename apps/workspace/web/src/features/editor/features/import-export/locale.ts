/**
 * Strings for the Workspace import/export UI. Since SDK 1.3 the exchange
 * clients no longer ship UI or locales; the wording follows the SDK 1.1 UI.
 */
const enUS = {
  "workspace-import-export": {
    uploading: "Uploading",
    uploadSuccess: "File uploaded successfully",
    uploadSuccessTip: "{0} file(s) uploaded successfully",
    downloading: "Downloading",
    downloadSuccess: "Download success",

    unknownMistake: "Unknown mistake",
    networkError: "Network error",
    tooLarge: "Data is too large",
    exportQuotaExceeded:
      "The export quota for the current license period is exhausted. Wait until the next period or contact your administrator to update the license.",
    licensePolicyInvalid:
      "The license contents are invalid. Contact your administrator to replace the license.",
    licenseVersionNotAllowed:
      "The current service version is outside the licensed range. Contact your administrator to update the license.",
    licenseNotYetEffective: "The license is not yet effective. Try again after it takes effect.",
    licenseUnitTypeRejected:
      "The current license does not cover this export type, or its type authorization has expired. Contact your administrator to update the license.",
    exportQuotaCheckFailed:
      "The remaining export quota could not be verified. Contact your administrator to check the service status.",
    licenseConcurrencyTimeout: "Export tasks are busy and the wait timed out. Try again later.",
    internalError: "Internal unknown error",
    interrupt: "The network connection was interrupted and the file upload failed",
    fileTypeError: "Selected file [{0}] is not supported for upload",

    wait: "Please wait...",
    cancel: "Cancel",
    confirm: "Confirm",
    uploadAgain: "Upload again",

    file: "File",
    upload: "Open(File)",
    download: "Save As",
  },
};

const zhCN: typeof enUS = {
  "workspace-import-export": {
    uploading: "上传中",
    uploadSuccess: "文件上传成功",
    uploadSuccessTip: "{0}个文件上传成功",
    downloading: "下载中",
    downloadSuccess: "下载成功",

    unknownMistake: "未知错误",
    networkError: "网络异常",
    tooLarge: "数据流过大",
    exportQuotaExceeded: "当前授权周期的导出次数已用完，请等待下一周期或联系管理员更新授权。",
    licensePolicyInvalid: "授权内容有误，请联系管理员更换授权。",
    licenseVersionNotAllowed: "当前服务版本超出授权范围，请联系管理员更新授权。",
    licenseNotYetEffective: "授权尚未生效，请在生效后重试。",
    licenseUnitTypeRejected: "当前授权未包含此导出类型，或该类型授权已到期，请联系管理员更新授权。",
    exportQuotaCheckFailed: "无法核验剩余导出次数，请联系管理员检查服务状态。",
    licenseConcurrencyTimeout: "当前导出任务繁忙，等待超时，请稍后重试。",
    internalError: "内部未知错误",
    interrupt: "网络连接中断，文件上传失败",
    fileTypeError: "所选文件 [{0}] 不支持上传",

    wait: "请稍等...",
    cancel: "取消",
    confirm: "确认",
    uploadAgain: "再次上传",

    file: "文件",
    upload: "打开（文件）",
    download: "另存为",
  },
};

export type ImportExportLocaleKey = keyof (typeof enUS)["workspace-import-export"];

export const IMPORT_EXPORT_LOCALES = { enUS, zhCN } as const;

export function importExportKey(key: ImportExportLocaleKey): string {
  return `workspace-import-export.${key}`;
}
