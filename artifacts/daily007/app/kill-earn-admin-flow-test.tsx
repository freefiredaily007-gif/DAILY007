import { Redirect } from 'expo-router';
import KillEarnAdminFlowNativeTest from '../src/screens/KillEarnAdminFlowNativeTest';

export default function KillEarnAdminFlowTestRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <KillEarnAdminFlowNativeTest />;
}
