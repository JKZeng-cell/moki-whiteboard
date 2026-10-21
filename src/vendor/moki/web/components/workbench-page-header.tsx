import type { ReactNode } from "react";
import { ArrowLeft, Settings } from 'lucide-react';
import { useNativeControls } from '../../../../web/native-context.js';

type WorkbenchPageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingClassName?: string;
  actionsClassName?: string;
};

export function WorkbenchPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
  headingClassName = "",
  actionsClassName = "",
}: WorkbenchPageHeaderProps) {
  const controls = useNativeControls();
  return (
    <header
      className={`workbench-page-header mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
      {controls ? <button className="native-app-control" title="返回白板管理页" aria-label="返回白板管理页" onClick={controls.back}><ArrowLeft size={18}/></button> : null}
      <div className={`min-w-0 ${headingClassName}`}>
        {eyebrow ? (
          <p className="text-[0.625rem] font-black uppercase leading-none tracking-[0.2em] text-[#625bc5]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-1" : ""} text-[1.375rem] font-black leading-none tracking-[-.04em] text-[#242a40]`}>
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-[0.6875rem] leading-4 text-[#9297a7]">
            {description}
          </p>
        ) : null}
      </div>
      </div>
      {actions || controls ? (
        <div className={`workbench-page-header-actions flex min-w-0 items-center ${actionsClassName}`}>
          {actions}
          {controls ? <button className="native-app-control" title="设置" aria-label="设置" onClick={controls.settings}><Settings size={17}/></button> : null}
        </div>
      ) : null}
    </header>
  );
}
