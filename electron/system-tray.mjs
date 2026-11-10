import nativeText from "./native-text.cjs";
import product from "./product-name.json" with { type: "json" };

// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit, t = nativeText.englishText.t }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
    "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  const label = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: t("native.tray.open", { app: product.name }), click: show },
    { type: "separator" },
    { label: t("native.tray.quit", { app: product.name }), click: onQuit },
  ]));
  tray.setToolTip(product.name);
  label();
  tray.on("click", show);
  tray.on("double-click", show);
  return {
    show,
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    relabel() { if (!tray.isDestroyed()) label(); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
