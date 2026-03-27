import { Notification } from "electron";

export function notify(title, message) {
    const notification = new Notification({ title, body: message });
    notification.show();
}