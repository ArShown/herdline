import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';

// Only a drag that starts this close to the left edge goes back, so lists and code blocks keep their own swipes.
const EDGE = 24;

// Touches inside a Modal still pass through its React parents, so an open viewer or sheet turns the swipe off.
const BlockContext = createContext<(blocked: boolean) => void>(() => {});

/** Turn off swiping back while `blocked` is true, e.g. while a full-screen viewer is open. */
export function useBlockSwipeBack(blocked: boolean) {
  const setBlocked = useContext(BlockContext);
  useEffect(() => {
    setBlocked(blocked);
    return () => setBlocked(false);
  }, [blocked, setBlocked]);
}

/** A screen on top of another that the user can drag off from the left edge, like iOS navigation. */
export function SwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onBack, width });
  latest.current = { onBack, width };
  const blocked = useRef(false);
  const setBlocked = useRef((value: boolean) => {
    blocked.current = value;
  }).current;

  const settle = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => !blocked.current && g.x0 <= EDGE && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        const { width, onBack } = latest.current;
        if (g.dx > width / 3 || g.vx > 0.5) {
          Animated.timing(x, { toValue: width, duration: 180, useNativeDriver: true }).start(() => onBack());
        } else {
          settle();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: settle,
    }),
  ).current;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.page, { transform: [{ translateX: x }] }]} {...responder.panHandlers}>
      <BlockContext.Provider value={setBlocked}>{children}</BlockContext.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: -2, height: 0 } },
});
