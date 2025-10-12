// Internal QCE plugin has been removed
// QCE is now loaded as an external plugin from plugins/ directory
// This file is kept for backwards compatibility but does nothing

export const plugin_init = async () => {
    // No-op: Internal plugin system removed
};

export const plugin_onmessage = async () => {
    // No-op
};

export const plugin_onevent = async () => {
    // No-op  
};

export const plugin_cleanup = async () => {
    // No-op
};
