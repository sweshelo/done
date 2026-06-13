import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";

export default function Pure() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
      </SafeAreaView>
      <WebView
        source={{ uri: 'https://donderhiroba.jp' }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures={false}
        style={styles.web}
      />
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  web: { flex: 1 },
})