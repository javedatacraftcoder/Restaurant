"use client";
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

declare global {
  interface Window {
    onTurnstileLoad?: () => void;
    turnstile?: any;
  }
}

type Props = {
  siteKey: string;
  onToken: (token: string) => void;
};

export type TurnstileWidgetHandle = {
  reset: () => void;
  getToken: () => string | null;
};

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(function TurnstileWidget(
  { siteKey, onToken },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    reset: () => {
      try {
        if (window?.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          lastTokenRef.current = null;
        }
      } catch {}
    },
    getToken: () => {
      try {
        if (window?.turnstile && widgetIdRef.current) {
          const t = window.turnstile.getResponse(widgetIdRef.current);
          if (t) lastTokenRef.current = t;
        }
      } catch {}
      return lastTokenRef.current || null;
    },
  }));

  useEffect(() => {
    const id = "turnstile-script";

    const render = () => {
      if (!containerRef.current || !window?.turnstile) return;
      containerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          lastTokenRef.current = token;
          onToken(token);
        },
        "expired-callback": () => {
          lastTokenRef.current = null;
          onToken("");
        },
        "timeout-callback": () => {
          lastTokenRef.current = null;
          onToken("");
        },
        "error-callback": () => {
          lastTokenRef.current = null;
          onToken("");
        },
        // Token se renueva automáticamente al expirar
        "refresh-expired": "auto",
        // Evita crear <input hidden> con el response
        "response-field": false,
        theme: "auto",
      });
    };

    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }

    window.onTurnstileLoad = () => render();
    if (window?.turnstile) render();

    return () => {};
  }, [siteKey, onToken]);

  return <div ref={containerRef} />;
});

export default TurnstileWidget;
