// The film-grain layer over the whole frame (app/motion.css .grain): a static texture that kills
// gradient banding on the dark background. Mounted once in app/layout.tsx.
// The cursor spotlight (.spot) and 3D tilt (.tilt) this file used to drive were removed in the
// site-quality pass (2026-10-26): cursor-chasing light and leaning cards competed with the content.
export default function MotionLayer() {
  return <div className="grain" aria-hidden="true" />
}
