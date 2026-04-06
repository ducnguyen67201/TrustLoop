/**
 * HTML response for OAuth popup flows.
 * Closes the popup and refreshes the opener, or redirects if opened directly.
 */
export function oauthPopupCloseHtml(options: {
  title: string;
  redirectUrl: string;
}): string {
  const { title, redirectUrl } = options;
  const safeRedirectUrl = JSON.stringify(redirectUrl);

  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666">
<p id="msg">Connecting...</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.location.reload();
      window.close();
    } else {
      document.getElementById("msg").textContent = "Redirecting...";
      window.location.href = ${safeRedirectUrl};
    }
  } catch (e) {
    document.getElementById("msg").textContent = "Done! You can close this window.";
  }
</script>
</body></html>`;
}
