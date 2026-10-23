export interface ComponentSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export interface ComponentInfo {
  name: string;
  props: Record<string, unknown>;
  source: ComponentSource;
  pathToSource: string;
}

export interface SelectedComponent extends ComponentInfo {
  editor: string;
  url: string;
}

export interface ClickedElement {
  tag?: string;
  id?: string;
  className?: string;
  role?: string;
  dataset?: Record<string, string>;
}

export interface Coordinates {
  x?: number;
  y?: number;
}

export interface OpenInEditorPayload {
  selected: SelectedComponent;
  components: ComponentInfo[];
  trigger: 'alt-click' | 'context-menu';
  coords?: Coordinates;
  clickedElement?: ClickedElement;
}

export interface ClickToComponentMessage {
  source: 'click-to-component';
  version: number;
  type: 'ready' | 'open-in-editor' | 'enable-button';
  payload?: OpenInEditorPayload;
}

export interface ClickToComponentEnableMessage {
  source: 'click-to-component';
  version: 1;
  type: 'enable-button';
}

export interface EventHandlers {
  onReady?: () => void;
  onOpenInEditor?: (payload: OpenInEditorPayload) => void;
  onUnknownMessage?: (message: unknown) => void;
}

export class ClickToComponentListener {
  private handlers: EventHandlers = {};
  private messageListener: ((event: MessageEvent) => void) | null = null;

  constructor(
    handlers: EventHandlers,
    private iframeRef: { current: HTMLIFrameElement | null }
  ) {
    this.handlers = handlers;
  }

  /**
   * Start listening for messages from click-to-component iframe
   */
  start(): void {
    if (this.messageListener) {
      this.stop(); // Clean up existing listener
    }

    this.messageListener = (event: MessageEvent) => {
      const iframe = this.iframeRef.current;
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow)
        return;
      const origin = this.iframeOrigin(iframe);
      if (!origin || event.origin !== origin) return;
      const data = event.data as ClickToComponentMessage;

      // Only handle messages from our click-to-component tool
      if (!data || data.source !== 'click-to-component') {
        return;
      }

      switch (data.type) {
        case 'ready':
          if (event.source) {
            const enableMsg: ClickToComponentEnableMessage = {
              source: 'click-to-component',
              version: 1,
              type: 'enable-button',
            };
            iframe.contentWindow.postMessage(enableMsg, origin);
          }
          this.handlers.onReady?.();
          break;

        case 'open-in-editor':
          if (data.payload) {
            this.handlers.onOpenInEditor?.(data.payload);
          }
          break;

        default:
          this.handlers.onUnknownMessage?.(data);
      }
    };

    window.addEventListener('message', this.messageListener);
  }

  /**
   * Stop listening for messages
   */
  stop(): void {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
  }

  /**
   * Update event handlers
   */
  setHandlers(handlers: EventHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  private iframeOrigin(iframe: HTMLIFrameElement): string | null {
    try {
      const origin = new URL(iframe.src, window.location.href).origin;
      return origin === 'null' ? null : origin;
    } catch {
      return null;
    }
  }

  sendToIframe(iframe: HTMLIFrameElement, message: unknown): void {
    if (iframe !== this.iframeRef.current) return;
    const origin = this.iframeOrigin(iframe);
    if (origin && iframe.contentWindow) {
      iframe.contentWindow.postMessage(message, origin);
    }
  }
}

// Convenience function for quick setup
export function listenToClickToComponent(
  handlers: EventHandlers,
  iframeRef: { current: HTMLIFrameElement | null }
): ClickToComponentListener {
  const listener = new ClickToComponentListener(handlers, iframeRef);
  listener.start();
  return listener;
}
