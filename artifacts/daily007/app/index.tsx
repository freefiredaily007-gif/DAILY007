// The existing React Navigation tree is isolated from Expo Router's root
// navigator so all original destinations and navigation params remain intact.
import { NavigationIndependentTree } from '@react-navigation/native';
import OriginalApp from '@/src/App';

export default function Index() {
  return (
    <NavigationIndependentTree>
      <OriginalApp />
    </NavigationIndependentTree>
  );
}