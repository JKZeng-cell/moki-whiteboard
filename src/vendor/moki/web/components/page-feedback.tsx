import { LoaderCircle } from "lucide-react";

/** A shared, bounded loading state; never replaces the native window surface. */
export function PageFeedback({ title, description }: { title: string; description: string }) {
  return <div className="moki-page-feedback grid h-full min-h-[160px] w-full place-items-center p-6" role="status" aria-label={title}>
    <div className="max-w-sm text-center">
      <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[#eeebfb] text-[#7864b2]">
        <LoaderCircle size={22} className="motion-safe:animate-spin" aria-hidden="true" />
      </span>
      <p className="text-sm font-bold text-[#292c41]">{title}</p>
      <p className="mt-2 text-xs leading-5 text-[#8d879a]">{description}</p>
    </div>
  </div>;
}
