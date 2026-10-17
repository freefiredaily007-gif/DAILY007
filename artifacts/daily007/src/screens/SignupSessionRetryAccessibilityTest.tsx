import { Redirect } from 'expo-router';
import Auth from './Auth';

export default function SignupSessionRetryAccessibilityTest() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Auth
      onDone={() => {}}
      devSessionPersistenceFailures={2}
    />
  );
}
