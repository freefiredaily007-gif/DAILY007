import appConfig from "../../../../daily007/app.json";

export const nativeApplicationVersion = appConfig.expo.version;
export const nativeBuildVersion = String(appConfig.expo.android.versionCode);
