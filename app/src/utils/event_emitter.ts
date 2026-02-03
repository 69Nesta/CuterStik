/**
 * Strongly typed EventEmitter with namespaces and multiple callbacks per event.
 *
 * Supports:
 *  - event namespaces (e.g. "load.scene")
 *  - multiple event names ("load, ready")
 *  - adding / removing / triggering callbacks
 */
export default class Event_emitter<
    EventMap extends Record<string, any[]> = Record<string, any[]>
> {
    private callbacks: Record<string, Record<string, Array<(...args: any[]) => any>>> = {
        base: {},
    };

    /**
     * Register one or multiple events.
     */
    on<K extends keyof EventMap | string>(
        names: K | string,
        callback: (...args: K extends keyof EventMap ? EventMap[K] : any[]) => void
    ): this {
        if (!names || typeof callback !== 'function') {
            console.warn('Invalid event name or callback');
            return this;
        }

        const eventNames = this.resolveNames(names.toString());

        eventNames.forEach((_name) => {
            const { namespace, value } = this.resolveName(_name);

            if (!this.callbacks[namespace]) this.callbacks[namespace] = {};
            if (!this.callbacks[namespace][value]) this.callbacks[namespace][value] = [];

            this.callbacks[namespace][value].push(callback);
        });

        return this;
    }

    /**
     * Remove one or multiple event listeners.
     */
    off(names: string): this {
        if (!names) {
            console.warn('Invalid event name');
            return this;
        }

        const eventNames = this.resolveNames(names);

        eventNames.forEach((_name) => {
            const { namespace, value } = this.resolveName(_name);

            if (namespace !== 'base' && value === '') {
                delete this.callbacks[namespace];
                return;
            }

            if (namespace === 'base') {
                for (const ns in this.callbacks) {
                    if (this.callbacks[ns]?.[value]) {
                        delete this.callbacks[ns][value];
                        if (Object.keys(this.callbacks[ns]).length === 0) delete this.callbacks[ns];
                    }
                }
            } else if (this.callbacks[namespace]?.[value]) {
                delete this.callbacks[namespace][value];
                if (Object.keys(this.callbacks[namespace]).length === 0) delete this.callbacks[namespace];
            }
        });

        return this;
    }

    /**
     * Trigger an event and call its listeners.
     */
    trigger<K extends keyof EventMap | string>(
        name: K | string,
        args?: K extends keyof EventMap ? EventMap[K] : any[]
    ): any {
        if (!name) {
            console.warn('Invalid event name');
            return;
        }

        const eventNames = this.resolveNames(name.toString());
        const { namespace, value } = this.resolveName(eventNames[0]!.toString());

        const argArray = Array.isArray(args) ? args : [];

        let finalResult: any;

        const invokeCallbacks = (callbacks?: Array<(...a: any[]) => any>) => {
            callbacks?.forEach((cb) => {
                const result = cb(...argArray);
                if (typeof finalResult === 'undefined') finalResult = result;
            });
        };

        if (namespace === 'base') {
            for (const ns in this.callbacks) {
                invokeCallbacks(this.callbacks[ns]?.[value]);
            }
        } else {
            invokeCallbacks(this.callbacks[namespace]?.[value]);
        }

        return finalResult;
    }

    /** Clean and split event names */
    private resolveNames(names: string): string[] {
        return names
            .replace(/[^a-zA-Z0-9 ,/.]/g, '')
            .replace(/[,/]+/g, ' ')
            .trim()
            .split(/\s+/);
    }

    /** Extract namespace and base name */
    private resolveName(name: string): { value: string; namespace: string; original: string } {
        const parts = name.split('.');
        return {
            original: name,
            value: parts[0]!,
            namespace: parts[1] || 'base',
        };
    }
}