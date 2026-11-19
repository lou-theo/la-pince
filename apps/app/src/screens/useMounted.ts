import { type RefObject, useEffect, useRef } from 'react';

/** Whether the screen is still shown when an answer arrives: a send that ends after the person left must not take them back. */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
