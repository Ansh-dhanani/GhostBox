"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

export default function LoginView({ onAuth }: { onAuth: () => void }) {
    const [value, setValue] = useState("");
    const [shake, setShake] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Auto-focus and skip login if no secret is configured (dev with no env var).
        const secret = process.env.NEXT_PUBLIC_GHOSTBOX_SECRET;
        if (!secret || secret === "") {
            onAuth();
            return;
        }
        inputRef.current?.focus();
    }, [onAuth]);

    function submit(e: FormEvent) {
        e.preventDefault();
        const secret = process.env.NEXT_PUBLIC_GHOSTBOX_SECRET || "";
        if (value === secret) {
            setLoading(true);
            // Brief visual pause before transition
            setTimeout(onAuth, 300);
        } else {
            setShake(true);
            setValue("");
            setTimeout(() => setShake(false), 500);
            inputRef.current?.focus();
        }
    }

    return (
        <div className="loginPage">
            <div className="loginCard">
                <div className="loginGhost">◈</div>
                <h1 className="loginTitle">GhostBox</h1>
                <p className="loginSub">Enter your access key to continue</p>
                <form onSubmit={submit} className={`loginForm ${shake ? "shake" : ""}`}>
                    <input
                        ref={inputRef}
                        type="password"
                        className="loginInput"
                        placeholder="Access key"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        autoComplete="current-password"
                        disabled={loading}
                        spellCheck={false}
                    />
                    <button type="submit" className="loginBtn" disabled={loading || value.length === 0}>
                        {loading ? <span className="loginSpinner" /> : "Enter"}
                    </button>
                </form>
            </div>
        </div>
    );
}
