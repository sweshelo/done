/**
 * ログイン状態判定（再設計版）。
 *
 * プロトタイプの不具合: 「現在 URL が index.php か」で判定していたため、
 * 再起動→自動ログインのリダイレクト連鎖で誤判定していた。
 *
 * 再設計方針: URL の形ではなく「保護リソース (score_list) が取得できるか」で定義する。
 * 認証済みなら score_list はスコアデータ (.contentBox / .songName) を返す。
 * 未認証ならログインページ (index.php) にリダイレクトされ、それらは存在しない。
 */

const BASE_URL = 'https://donderhiroba.jp';

export interface LoginState {
  loggedIn: boolean;
  reason: string;
}

export async function probeLoginState(): Promise<LoginState> {
  try {
    const res = await globalThis.fetch(`${BASE_URL}/score_list.php?genre=1`, {
      credentials: 'include',
    });
    const html = await res.text();
    const dom = new DOMParser().parseFromString(html, 'text/html');

    // 認証済みシグナル: スコアデータが返っている
    if (dom.querySelector('.contentBox') || dom.querySelector('.songName')) {
      return { loggedIn: true, reason: 'score-data-present' };
    }

    // 未認証シグナル: ログインフォーム / index.php への誘導
    if (
      /index\.php/.test(res.url) ||
      dom.querySelector('form[action*="login"], form[action*="twitter"]') ||
      /ログイン|login/i.test(dom.body?.textContent ?? '')
    ) {
      return { loggedIn: false, reason: 'login-page' };
    }

    return { loggedIn: false, reason: 'no-score-data' };
  } catch (e) {
    return { loggedIn: false, reason: `error:${String(e)}` };
  }
}
