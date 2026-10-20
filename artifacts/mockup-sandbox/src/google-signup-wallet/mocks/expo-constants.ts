import appConfig from "../../../../daily007/app.json";

export default {
  expoConfig: {
    ...appConfig.expo,
    hostUri: "daily007-test.example.invalid:8081",
  },
};
