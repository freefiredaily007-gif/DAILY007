import { Redirect } from 'expo-router';
import HomeMatchBackNativeTest from '../src/screens/HomeMatchBackNativeTest';

export default function HomeMatchBackTestRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <HomeMatchBackNativeTest />;
}
