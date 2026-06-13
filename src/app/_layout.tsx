import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { DATABASE_NAME, runMigrations } from '@/db';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Suspense
        fallback={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
          </View>
        }>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={runMigrations} useSuspense>
          <AnimatedSplashOverlay />
          <AppTabs />
        </SQLiteProvider>
      </Suspense>
    </ThemeProvider>
  );
}
