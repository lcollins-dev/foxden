import { shallowRef } from 'vue';

/**
 * The modal dialogs open now, oldest first. A modal sits in the browser's top layer and makes the page outside it inert,
 * so anything that must stay above it and usable, such as toasts, renders inside the newest one.
 */
export const openModals = shallowRef<HTMLDialogElement[]>([]);
