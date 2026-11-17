// NativeWind 4.2 ships its `className` augmentation in <pkg>/types.d.ts, but
// points package.json#types at dist/index.d.ts, so the documented
// `/// <reference types="nativewind/types" />` silently resolves to the wrong
// file and className stays untyped. Declare the props we actually use instead
// of depending on that broken chain (and on npm hoisting layout).
import 'react-native';
import 'expo-linear-gradient';

declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
  }
  interface ScrollViewProps {
    className?: string;
    contentContainerClassName?: string;
  }
  interface PressableProps {
    className?: string;
  }
  interface ImageProps {
    className?: string;
  }
}

declare module 'expo-linear-gradient' {
  interface LinearGradientProps {
    className?: string;
  }
}
