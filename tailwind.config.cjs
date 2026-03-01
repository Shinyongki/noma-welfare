/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './stitch/**/*.html',
    ],
    theme: {
        extend: {
            colors: {
                "primary": "#98002E",
                "primary-light": "#B8003E",
                "bg-warm": "#F8F5F2",
                "bg-section": "#F1ECE7",
                "deep-purple": "#4A1942",
                "sidebar-start": "#1B1033",
                "sidebar-end": "#2D1B4E",
                "content-bg": "#F4F6FA",
            },
            fontFamily: {
                "sans": [
                    "Pretendard Variable", "Pretendard",
                    "-apple-system", "BlinkMacSystemFont", "system-ui",
                    "Roboto", "Noto Sans KR", "Malgun Gothic", "sans-serif",
                ],
            },
            borderRadius: {
                "DEFAULT": "0.5rem",
                "lg": "1rem",
                "xl": "1.5rem",
                "2xl": "2rem",
                "3xl": "2.5rem",
                "full": "9999px",
            },
            keyframes: {
                'fade-up': {
                    '0%': { opacity: '0', transform: 'translateY(24px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'fade-in': {
                    'from': { opacity: '0', transform: 'translateY(8px)' },
                    'to': { opacity: '1', transform: 'translateY(0)' },
                },
                'slide-down': {
                    '0%': { opacity: '0', transform: 'translateY(-12px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'pulse-soft': {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.6' },
                },
                'shimmer': {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'slide-in-right': {
                    'from': { transform: 'translateX(100%)' },
                    'to': { transform: 'translateX(0)' },
                },
                'slide-out-right': {
                    'from': { transform: 'translateX(0)' },
                    'to': { transform: 'translateX(100%)' },
                },
            },
            animation: {
                'fade-up': 'fade-up 0.5s ease-out forwards',
                'fade-up-delay-1': 'fade-up 0.5s ease-out 0.1s forwards',
                'fade-up-delay-2': 'fade-up 0.5s ease-out 0.2s forwards',
                'fade-up-delay-3': 'fade-up 0.5s ease-out 0.3s forwards',
                'fade-in': 'fade-in 0.4s ease-out forwards',
                'slide-down': 'slide-down 0.3s ease-out forwards',
                'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
                'shimmer': 'shimmer 2s linear infinite',
                'slide-in-right': 'slide-in-right 0.3s ease-out both',
                'slide-out-right': 'slide-out-right 0.25s ease-in both',
            },
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries'),
    ],
};
