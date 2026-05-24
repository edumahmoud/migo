'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/context';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'ocean' | 'amber' | 'rose' | 'teal' | 'violet' | 'sky';
}

// -------------------------------------------------------
// Color map – each card gets a distinct, vibrant identity
// -------------------------------------------------------
const colorMap = {
  ocean: {
    gradient: 'from-sky-600 to-teal-500',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-sky-100',
    cardBg: 'bg-gradient-to-br from-sky-600 to-teal-500',
    border: 'border-sky-400',
    shadow: 'shadow-sky-200/50 hover:shadow-sky-300/60',
  },
  teal: {
    gradient: 'from-teal-500 to-teal-600',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-teal-100',
    cardBg: 'bg-gradient-to-br from-teal-500 to-teal-600',
    border: 'border-teal-400',
    shadow: 'shadow-teal-200/50 hover:shadow-teal-300/60',
  },
  amber: {
    gradient: 'from-amber-400 to-amber-500',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-amber-100',
    cardBg: 'bg-gradient-to-br from-amber-400 to-amber-500',
    border: 'border-amber-300',
    shadow: 'shadow-amber-200/50 hover:shadow-amber-300/60',
  },
  rose: {
    gradient: 'from-rose-400 to-rose-500',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-rose-100',
    cardBg: 'bg-gradient-to-br from-rose-400 to-rose-500',
    border: 'border-rose-300',
    shadow: 'shadow-rose-200/50 hover:shadow-rose-300/60',
  },
  violet: {
    gradient: 'from-violet-500 to-violet-600',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-violet-100',
    cardBg: 'bg-gradient-to-br from-violet-500 to-violet-600',
    border: 'border-violet-400',
    shadow: 'shadow-violet-200/50 hover:shadow-violet-300/60',
  },
  sky: {
    gradient: 'from-sky-400 to-sky-500',
    iconBg: 'bg-white/25',
    iconText: 'text-white',
    valueText: 'text-white',
    labelText: 'text-sky-100',
    cardBg: 'bg-gradient-to-br from-sky-400 to-sky-500',
    border: 'border-sky-300',
    shadow: 'shadow-sky-200/50 hover:shadow-sky-300/60',
  },
} as const;

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function StatCard({ icon, label, value, color }: StatCardProps) {
  const { dir } = useI18n();
  const colors = colorMap[color];

  return (
    <motion.div
      whileHover={{ scale: 1.04, y: -4 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="group"
    >
      <Card
        className={`${colors.cardBg} ${colors.border} ${colors.shadow} transition-all duration-200 shadow-md hover:shadow-lg cursor-default border-0`}
        dir={dir}
      >
        <CardContent className="flex items-center gap-3 p-3 sm:p-4">
          {/* Icon */}
          <div
            className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg ${colors.iconBg} backdrop-blur-sm transition-transform duration-200 group-hover:scale-110`}
          >
            <span className={colors.iconText}>{icon}</span>
          </div>

          {/* Label & Value */}
          <div className="flex flex-col gap-0.5 text-start min-w-0">
            <span className={`text-xs sm:text-sm font-medium truncate ${colors.labelText}`}>{label}</span>
            <span className={`text-lg sm:text-xl font-bold leading-tight ${colors.valueText}`}>
              {value ?? 0}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
