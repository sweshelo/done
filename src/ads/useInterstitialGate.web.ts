/** web では全画面広告を出さない no-op 実装。overlay は描画しない。 */
export function useInterstitialGate() {
  return { maybeShow: (): boolean => false, overlay: null };
}
