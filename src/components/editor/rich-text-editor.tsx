'use client'

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Youtube from '@tiptap/extension-youtube'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import Color from '@tiptap/extension-color'
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { common, createLowlight } from 'lowlight'
import { Extension, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Image as ImageIcon,
  Video,
  Table as TableIcon,
  Code,
  Quote,
  Minus,
  Undo2,
  Redo2,
  RemoveFormatting,
  Maximize2,
  Minimize2,
  Palette,
  Highlighter,
  Plus,
  ChevronDown,
  Check,
  Upload,
  Trash2,
  PlusCircle,
  MinusCircle,
  Type,
  X,
  ArrowLeftToLine,
  ArrowRightToLine,
  Columns2,
  Columns3,
  FlipHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

// ─── Text Direction Extension ──────────────────────────────────────────────
// Adds `dir` attribute to paragraph, heading, and codeBlock nodes so RTL/LTR works properly
const TextDirectionExtension = Extension.create({
  name: 'textDirection',

  addOptions() {
    return {
      types: ['heading', 'paragraph', 'codeBlock'],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => element.getAttribute('dir'),
            renderHTML: (attributes) => {
              if (!attributes.dir) return {}
              return { dir: attributes.dir }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setTextDirection:
        (direction: string) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection
          let applicable = false
          const types = this.options.types as string[]

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (types.includes(node.type.name)) {
              applicable = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  dir: direction,
                })
              }
            }
          })

          if (dispatch && applicable) {
            dispatch(tr.scrollIntoView())
          }

          return applicable
        },
    }
  },
})

// ─── Lowlight instance for code block syntax highlighting ───────────────────
const lowlight = createLowlight(common)
// Register MySQL as an alias of SQL for syntax highlighting
try {
  lowlight.register('mysql', common.sql)
} catch {
  // MySQL may already be registered or unavailable in some environments
}

// ─── Custom Image Extension (width + alignment + float) ───────────────────
const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: (element) => element.getAttribute('width') || element.style.width || '100%',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {}
          return { width: attributes.width as string, style: `width: ${attributes.width}` }
        },
      },
      'data-align': {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') || 'center',
        renderHTML: (attributes: Record<string, unknown>) => {
          return { 'data-align': attributes['data-align'] as string }
        },
      },
      'data-float': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-float') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['data-float']) return {}
          return { 'data-float': attributes['data-float'] as string }
        },
      },
    }
  },
})

const setImageOptions = (opts: { src: string; width?: string; 'data-align'?: string; 'data-float'?: string | null }) => opts as any

// ─── Custom YouTube Extension (width + alignment) ────────────────────────────
const CustomYoutube = Youtube.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: (element) => element.style.width || element.getAttribute('width') || '100%',
        renderHTML: (attributes) => {
          if (!attributes.width || attributes.width === '100%') return {}
          return { style: `width: ${attributes.width}` }
        },
      },
      'data-align': {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') || 'center',
        renderHTML: (attributes) => {
          return { 'data-align': attributes['data-align'] }
        },
      },
    }
  },
})

// ─── Column Node (single column inside Columns) ───────────────────────────
const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-column': '', class: 'editor-column' }, 0]
  },
})

// ─── Columns Node (multi-column layout container) ─────────────────────────
const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  defining: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element) => parseInt(element.getAttribute('data-cols') || '2', 10),
        renderHTML: (attributes) => {
          return { 'data-cols': String(attributes.cols) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-columns]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-columns': '', class: 'editor-columns' }, 0]
  },

  addCommands() {
    return {
      insertColumns:
        (cols: number = 2) =>
        ({ tr, dispatch, editor }: any) => {
          const columnType = editor.schema.nodes.column
          const columnsType = editor.schema.nodes.columns
          if (!columnType || !columnsType) return false

          const columnCount = Math.min(Math.max(cols, 2), 3)
          // Build the right number of column children
          const columnNodes = Array.from({ length: columnCount }, () =>
            columnType.create(null, editor.schema.nodes.paragraph.create())
          )
          const columnsNode = columnsType.create({ cols: columnCount }, columnNodes)

          if (dispatch) {
            const { from } = tr.selection
            dispatch(tr.replaceSelectionWith(columnsNode, false))
          }
          return true
        },
    } as any
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => {
      const cols = node.attrs.cols || 2
      return (
        <NodeViewWrapper className={cn('editor-columns', `editor-columns-${cols}`)}>
          <NodeViewContent className="editor-columns-content" />
        </NodeViewWrapper>
      )
    })
  },
})

// Module augmentation for insertColumns command
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (cols?: number) => ReturnType
    }
  }
}

// ─── Preset Colors ──────────────────────────────────────────────────────────
const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc',
  '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff',
  '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
  '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
]

const HIGHLIGHT_COLORS = [
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Pink', value: '#fbcfe8' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Blue', value: '#bfdbfe' },
  { label: 'Purple', value: '#e9d5ff' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'Red', value: '#fecaca' },
  { label: 'None', value: '' },
]

// ─── Props ──────────────────────────────────────────────────────────────────
export interface RichTextEditorProps {
  content: any // TipTap JSON content
  onChange?: (json: any, html: string) => void
  placeholder?: string
  editable?: boolean
  subjectId?: string // For image upload path
  userId?: string // For image upload path
  dir?: 'rtl' | 'ltr'
}

// ─── Toolbar Button Helper ──────────────────────────────────────────────────
interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  tooltip: string
  children: React.ReactNode
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  tooltip,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'inline-flex items-center justify-center h-8 w-8 rounded-md text-sm transition-colors',
            'hover:bg-muted disabled:opacity-40 disabled:pointer-events-none',
            isActive && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
            !isActive && 'text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Toolbar Divider ────────────────────────────────────────────────────────
function ToolbarDivider() {
  return <Separator orientation="vertical" className="h-6 mx-1" />
}

// ─── Image Upload Helper ────────────────────────────────────────────────────
async function uploadImageToSupabase(
  file: File,
  subjectId: string,
  userId: string
): Promise<string | null> {
  if (!isSupabaseConfigured) {
    toast.error('Supabase is not configured. Image upload is unavailable.')
    return null
  }

  const timestamp = Date.now()
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = `lessons/${subjectId}/${userId}/${timestamp}_${sanitized}`

  const { error } = await supabase.storage
    .from('lesson-images')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    toast.error(`Image upload failed: ${error.message}`)
    return null
  }

  const { data: urlData } = supabase.storage
    .from('lesson-images')
    .getPublicUrl(filePath)

  return urlData?.publicUrl || null
}

// ─── MediaSelection Toolbar (BubbleMenu) ──────────────────────────────────
// Floating toolbar that appears near the selected image or YouTube video
function MediaToolbar({ editor }: { editor: Editor }) {
  const isImage = editor.isActive('image')
  const isYoutube = editor.isActive('youtube')

  if (!isImage && !isYoutube) return null

  const nodeType = isImage ? 'image' : 'youtube'
  const currentWidth = editor.getAttributes(nodeType).width || '100%'
  const currentAlign = editor.getAttributes(nodeType)['data-align'] || 'center'
  const currentFloat = editor.getAttributes(nodeType)['data-float'] || null

  const sizeOptions = [
    { label: 'S', value: '25%', tooltip: 'Small (25%)' },
    { label: 'M', value: '50%', tooltip: 'Medium (50%)' },
    { label: 'L', value: '75%', tooltip: 'Large (75%)' },
    { label: 'F', value: '100%', tooltip: 'Full Width' },
  ]

  const alignOptions = [
    { value: 'left', icon: AlignLeft, tooltip: 'Align Left' },
    { value: 'center', icon: AlignCenter, tooltip: 'Align Center' },
    { value: 'right', icon: AlignRight, tooltip: 'Align Right' },
  ]

  // Float is only available for images
  const floatOptions = isImage ? [
    { value: 'left', tooltip: 'Float Left (text wraps around)' },
    { value: 'right', tooltip: 'Float Right (text wraps around)' },
  ] : []

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }: { editor: Editor }) => {
        return e.isActive('image') || e.isActive('youtube')
      }}
      updateDelay={0}
      className="flex flex-wrap items-center gap-0.5 rounded-lg border bg-background px-1.5 py-1 shadow-lg"
    >
      {/* Size buttons */}
      {sizeOptions.map((opt) => (
        <Tooltip key={opt.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().updateAttributes(nodeType, { width: opt.value }).run()
              }}
              className={cn(
                'inline-flex items-center justify-center h-7 w-7 rounded text-xs font-bold transition-colors',
                'hover:bg-muted',
                currentWidth === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
                currentWidth !== opt.value && 'text-foreground'
              )}
            >
              {opt.label}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {opt.tooltip}
          </TooltipContent>
        </Tooltip>
      ))}

      {/* Custom width input */}
      <CustomWidthInput editor={editor} nodeType={nodeType} currentWidth={currentWidth} />

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Alignment buttons */}
      {alignOptions.map((opt) => (
        <Tooltip key={opt.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().updateAttributes(nodeType, { 'data-align': opt.value }).run()
              }}
              className={cn(
                'inline-flex items-center justify-center h-7 w-7 rounded transition-colors',
                'hover:bg-muted',
                currentAlign === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
                currentAlign !== opt.value && 'text-foreground'
              )}
            >
              <opt.icon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {opt.tooltip}
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Float buttons (images only) */}
      {floatOptions.length > 0 && (
        <>
          {floatOptions.map((opt) => (
            <Tooltip key={`float-${opt.value}`}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (currentFloat === opt.value) {
                      // Toggle off: remove float
                      editor.chain().focus().updateAttributes(nodeType, { 'data-float': null, 'data-align': 'center' }).run()
                    } else {
                      // Set float and auto-adjust width to 50% for better text wrapping
                      editor.chain().focus().updateAttributes(nodeType, {
                        'data-float': opt.value,
                        'data-align': opt.value,
                        width: currentWidth === '100%' ? '50%' : currentWidth,
                      }).run()
                    }
                  }}
                  className={cn(
                    'inline-flex items-center justify-center h-7 w-7 rounded transition-colors',
                    'hover:bg-muted',
                    currentFloat === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
                    currentFloat !== opt.value && 'text-foreground'
                  )}
                >
                  <FlipHorizontal className={cn('h-3.5 w-3.5', opt.value === 'right' && 'rotate-180')} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {opt.tooltip}
              </TooltipContent>
            </Tooltip>
          ))}
          {/* Remove float button */}
          {currentFloat && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().updateAttributes(nodeType, { 'data-float': null, 'data-align': 'center' }).run()
                  }}
                  className="inline-flex items-center justify-center h-7 w-7 rounded text-xs font-bold transition-colors hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Remove Float
              </TooltipContent>
            </Tooltip>
          )}
          <Separator orientation="vertical" className="h-5 mx-1" />
        </>
      )}

      {/* Delete button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().deleteSelection().run()
            }}
            className="inline-flex items-center justify-center h-7 w-7 rounded text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {isImage ? 'Delete Image' : 'Delete Video'}
        </TooltipContent>
      </Tooltip>
    </BubbleMenu>
  )
}

// ─── Custom Width Input ──────────────────────────────────────────────────
function CustomWidthInput({ editor, nodeType, currentWidth }: { editor: Editor; nodeType: string; currentWidth: string }) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleApply = useCallback(() => {
    const val = inputValue.trim()
    if (!val) {
      setIsEditing(false)
      return
    }
    // Allow values like "50%", "75%", "100%", "300px", "500"
    let widthValue = val
    if (/^\d+$/.test(val)) {
      // Pure number → treat as percentage
      widthValue = val + '%'
    }
    editor.chain().focus().updateAttributes(nodeType, { width: widthValue }).run()
    setIsEditing(false)
  }, [editor, nodeType, inputValue])

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleApply()
          } else if (e.key === 'Escape') {
            setIsEditing(false)
          }
        }}
        onBlur={handleApply}
        onMouseDown={(e) => e.preventDefault()}
        placeholder="50%"
        className="h-7 w-12 rounded border bg-background px-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    )
  }

  // Display current width as a clickable button
  const displayValue = currentWidth || '100%'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setInputValue(displayValue.replace('%', ''))
            setIsEditing(true)
          }}
          className="inline-flex items-center justify-center h-7 px-1.5 rounded text-xs font-mono transition-colors hover:bg-muted text-foreground"
        >
          {displayValue}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Click to set custom width (e.g. 40%, 300px)
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function RichTextEditor({
  content,
  onChange,
  placeholder = 'Start writing...',
  editable = true,
  subjectId,
  userId,
  dir = 'ltr',
}: RichTextEditorProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Editor ───────────────────────────────────────────────────────────────
  const editor = useEditor({
    editable,
    content: content || undefined,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // replaced by CodeBlockLowlight
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-sky-600 underline cursor-pointer',
        },
      }),
      CustomImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'rounded-lg h-auto',
        },
      }),
      CustomYoutube.configure({
        inline: false,
        nocookie: true,
        HTMLAttributes: {
          class: 'youtube-embed-wrapper',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse border border-border',
        },
      }),
      TableRow,
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border p-2 min-w-[80px]',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-border p-2 min-w-[80px] bg-muted font-semibold',
        },
      }),
      Columns,
      Column,
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-lg bg-muted font-mono text-sm',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Color,
      TextStyle,
      FontSize,
      FontFamily,
      Typography,
      TextDirectionExtension,
    ],
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getJSON(), e.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'prose-editor outline-none',
        dir,
      },
    },
  })

  // ─── Image upload handler ─────────────────────────────────────────────────
  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!subjectId || !userId) {
        toast.error('Image upload requires subjectId and userId.')
        return
      }
      const url = await uploadImageToSupabase(file, subjectId, userId)
      if (url && editor) {
        editor.chain().focus().setImage(setImageOptions({ src: url, width: '100%', 'data-align': 'center' })).run()
      }
    },
    [editor, subjectId, userId]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        if (!file.type.startsWith('image/')) {
          toast.error('Please select an image file.')
          return
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error('Image must be less than 10 MB.')
          return
        }
        handleImageUpload(file)
      }
      // Reset so the same file can be re-uploaded
      e.target.value = ''
    },
    [handleImageUpload]
  )

  // Update editor content when the content prop changes
  React.useEffect(() => {
    if (editor && content && !editable) {
      try {
        const currentContent = editor.getJSON()
        // Only update if content actually changed (deep comparison via JSON string)
        if (JSON.stringify(currentContent) !== JSON.stringify(content)) {
          editor.commands.setContent(content)
        }
      } catch {
        // Fallback: always set content if comparison fails
        editor.commands.setContent(content)
      }
    }
  }, [content, editor, editable])

  if (!editor) return null

  // ─── Read-only mode: render content without toolbar ──────────────────────
  if (!editable) {
    return (
      <div
        className="rich-text-editor rounded-xl border bg-white dark:bg-card overflow-hidden"
        dir={dir}
      >
        <EditorContent
          editor={editor}
          className="prose-editor-wrapper p-6"
        />
      </div>
    )
  }

  // ─── Toolbar & Editor Content (shared between normal & fullscreen) ────────
  const toolbarContent = (
    <div
      className={cn(
        'sticky top-0 z-10 flex flex-wrap items-center gap-0.5 bg-background border-b px-2 py-1.5',
        isFullscreen && 'px-4'
      )}
    >
      {/* 1. Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        tooltip="Undo"
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        tooltip="Redo"
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 2. Heading Dropdown */}
      <HeadingDropdown editor={editor} dir={dir} />

      <ToolbarDivider />

      {/* Font Size & Font Family Dropdowns */}
      <FontSizeDropdown editor={editor} dir={dir} />
      <FontFamilyDropdown editor={editor} dir={dir} />

      <ToolbarDivider />

      {/* 3. Bold / Italic / Underline / Strike */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        tooltip="Bold"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        tooltip="Italic"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        tooltip="Underline"
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        tooltip="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 4. Text Color + Highlight */}
      <ColorPickerPopover editor={editor} dir={dir} />
      <HighlightPickerPopover editor={editor} dir={dir} />

      <ToolbarDivider />

      {/* 5. Alignment */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign(dir === 'rtl' ? 'right' : 'left').run()}
        isActive={editor.isActive({ textAlign: dir === 'rtl' ? 'right' : 'left' })}
        tooltip={dir === 'rtl' ? 'Align Right' : 'Align Left'}
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        isActive={editor.isActive({ textAlign: 'center' })}
        tooltip="Align Center"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign(dir === 'rtl' ? 'left' : 'right').run()}
        isActive={editor.isActive({ textAlign: dir === 'rtl' ? 'left' : 'right' })}
        tooltip={dir === 'rtl' ? 'Align Left' : 'Align Right'}
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>

      {/* Text Direction (RTL/LTR) */}
      <ToolbarButton
        onClick={() => {
          editor.chain().focus().setTextDirection('rtl').run()
        }}
        isActive={
          (editor.isActive('paragraph') && editor.getAttributes('paragraph').dir === 'rtl') ||
          (editor.isActive('heading') && editor.getAttributes('heading').dir === 'rtl') ||
          (editor.isActive('codeBlock') && editor.getAttributes('codeBlock').dir === 'rtl')
        }
        tooltip="RTL Direction"
      >
        <ArrowRightToLine className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => {
          editor.chain().focus().setTextDirection('ltr').run()
        }}
        isActive={
          (editor.isActive('paragraph') && editor.getAttributes('paragraph').dir === 'ltr') ||
          (editor.isActive('heading') && editor.getAttributes('heading').dir === 'ltr') ||
          (editor.isActive('codeBlock') && editor.getAttributes('codeBlock').dir === 'ltr')
        }
        tooltip="LTR Direction"
      >
        <ArrowLeftToLine className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 6. Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        tooltip="Bullet List"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        tooltip="Ordered List"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 7. Link / Image / YouTube */}
      <LinkPopover editor={editor} dir={dir} />
      <ImagePopover
        editor={editor}
        dir={dir}
        onUploadClick={() => fileInputRef.current?.click()}
      />
      <ToolbarButton
        onClick={() => {
          const url = window.prompt('Enter YouTube URL:')
          if (url) {
            editor.chain().focus().setYoutubeVideo({ src: url }).run()
          }
        }}
        tooltip="Embed YouTube Video"
      >
        <Video className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 8. Table / Columns / Code Block / Quote / HR */}
      <TablePopover editor={editor} dir={dir} />
      <ColumnsPopover editor={editor} dir={dir} />
      <CodeBlockPopover editor={editor} dir={dir} />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        tooltip="Blockquote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        tooltip="Horizontal Rule"
      >
        <Minus className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 9. Clear Formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        tooltip="Clear Formatting"
      >
        <RemoveFormatting className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* 10. Fullscreen Toggle */}
      <ToolbarButton
        onClick={() => setIsFullscreen((v) => !v)}
        tooltip={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </ToolbarButton>
    </div>
  )

  const editorContent = (
    <div className="relative flex-1 min-h-0">
      <EditorContent
        editor={editor}
        className={cn(
          'prose-editor-wrapper min-h-[400px] h-full',
          isFullscreen ? 'p-8' : 'p-6'
        )}
      />
      {/* Floating media toolbar (BubbleMenu positions itself) */}
      <MediaToolbar editor={editor} />
    </div>
  )

  // ─── Hidden file input for image upload ───────────────────────────────────
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileInputChange}
    />
  )

  return (
    <>
      {/* Normal mode editor */}
      <div
        className={cn(
          'rich-text-editor rounded-xl border bg-white dark:bg-card overflow-hidden',
          'flex flex-col'
        )}
        dir={dir}
      >
        {toolbarContent}
        {editorContent}
        {fileInput}
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent
          className="max-w-full w-screen h-screen max-h-screen rounded-none border-0 p-0 flex flex-col"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Fullscreen Editor</DialogTitle>
            <DialogDescription>Edit content in fullscreen mode</DialogDescription>
          </DialogHeader>
          <div
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
            dir={dir}
          >
            {toolbarContent}
            <div className="flex-1 overflow-y-auto">
              {editorContent}
            </div>
          </div>
          {fileInput}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Heading Dropdown ───────────────────────────────────────────────────────
function HeadingDropdown({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)

  const currentHeading = editor.isActive('heading', { level: 1 })
    ? 'H1'
    : editor.isActive('heading', { level: 2 })
      ? 'H2'
      : editor.isActive('heading', { level: 3 })
        ? 'H3'
        : 'P'

  const options = [
    { label: 'Paragraph', value: 'P', icon: Type, action: () => editor.chain().focus().setParagraph().run() },
    { label: 'Heading 1', value: 'H1', icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', value: 'H2', icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', value: 'H3', icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center gap-1 h-8 px-2 rounded-md text-sm font-medium transition-colors',
                'hover:bg-muted',
                currentHeading !== 'P' && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <span className="w-6 text-center">{currentHeading}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Heading
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-40 p-1"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              opt.action()
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
              'hover:bg-muted',
              currentHeading === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
            )}
          >
            <opt.icon className="h-4 w-4" />
            <span>{opt.label}</span>
            {currentHeading === opt.value && <Check className="h-3 w-3 ms-auto" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ─── Color Picker Popover ───────────────────────────────────────────────────
function ColorPickerPopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const currentColor = editor.getAttributes('textStyle').color || ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted'
              )}
            >
              <Palette className="h-4 w-4" />
              <span
                className="absolute bottom-0.5 start-1.5 h-1 w-5 rounded-full"
                style={{ backgroundColor: currentColor || '#000000' }}
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Text Color
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-auto p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-2">
          <Label className="text-xs font-medium">Text Color</Label>
          <div className="grid grid-cols-10 gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={cn(
                  'h-5 w-5 rounded-sm border border-border/50 transition-transform hover:scale-110',
                  currentColor === color && 'ring-2 ring-ring ring-offset-1'
                )}
                style={{ backgroundColor: color }}
                onClick={() => {
                  editor.chain().focus().setColor(color).run()
                  setOpen(false)
                }}
                title={color}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              editor.chain().focus().unsetColor().run()
              setOpen(false)
            }}
          >
            Remove Color
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Highlight Picker Popover ───────────────────────────────────────────────
function HighlightPickerPopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const currentHighlight = editor.getAttributes('highlight').color || ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted',
                currentHighlight && 'bg-sky-100 dark:bg-sky-900/30'
              )}
            >
              <Highlighter className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Highlight
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-auto p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-2">
          <Label className="text-xs font-medium">Highlight Color</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {HIGHLIGHT_COLORS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors border',
                  'hover:bg-muted',
                  currentHighlight === item.value && 'ring-2 ring-ring'
                )}
                onClick={() => {
                  if (item.value) {
                    editor.chain().focus().toggleHighlight({ color: item.value }).run()
                  } else {
                    editor.chain().focus().unsetHighlight().run()
                  }
                  setOpen(false)
                }}
              >
                {item.value ? (
                  <span
                    className="h-3 w-3 rounded-sm border border-border/50 shrink-0"
                    style={{ backgroundColor: item.value }}
                  />
                ) : (
                  <X className="h-3 w-3 shrink-0" />
                )}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Link Popover ───────────────────────────────────────────────────────────
function LinkPopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const currentHref = editor.getAttributes('link').href || ''

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      setUrl(currentHref)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleSetLink = () => {
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted',
                editor.isActive('link') && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <LinkIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Insert Link
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-80 p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-2">
          <Label className="text-xs font-medium">Link URL</Label>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSetLink()
                }
              }}
            />
            <Button size="sm" className="h-8 px-3" onClick={handleSetLink}>
              Apply
            </Button>
          </div>
          {currentHref && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-destructive"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                setOpen(false)
              }}
            >
              <Trash2 className="h-3 w-3 me-1" />
              Remove Link
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Image Popover ──────────────────────────────────────────────────────────
function ImagePopover({
  editor,
  dir,
  onUploadClick,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
  onUploadClick: () => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      setUrl('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleInsertFromUrl = () => {
    if (!url) return
    editor.chain().focus().setImage(setImageOptions({ src: url, width: '100%', 'data-align': 'center' })).run()
    setOpen(false)
    setUrl('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted',
                editor.isActive('image') && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <ImageIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Insert Image
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-80 p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Image URL</Label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleInsertFromUrl()
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleInsertFromUrl}
                disabled={!url}
              >
                Insert
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs font-medium">Upload Image</Label>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                onUploadClick()
                setOpen(false)
              }}
            >
              <Upload className="h-3.5 w-3.5 me-1.5" />
              Choose File
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Columns Popover ─────────────────────────────────────────────────────────
function ColumnsPopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const isInColumns = editor.isActive('columns')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted',
                isInColumns && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <Columns2 className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Columns
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-52 p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-2">
          <Label className="text-xs font-medium">Columns Layout</Label>

          {!isInColumns ? (
            <div className="space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs gap-2"
                onClick={() => {
                  editor.chain().focus().insertColumns(2).run()
                  setOpen(false)
                }}
              >
                <Columns2 className="h-4 w-4" />
                2 Columns
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs gap-2"
                onClick={() => {
                  editor.chain().focus().insertColumns(3).run()
                  setOpen(false)
                }}
              >
                <Columns3 className="h-4 w-4" />
                3 Columns
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs gap-2"
                onClick={() => {
                  editor.chain().focus().updateAttributes('columns', { cols: 2 }).run()
                  setOpen(false)
                }}
              >
                <Columns2 className="h-4 w-4" />
                Switch to 2 Columns
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs gap-2"
                onClick={() => {
                  editor.chain().focus().updateAttributes('columns', { cols: 3 }).run()
                  setOpen(false)
                }}
              >
                <Columns3 className="h-4 w-4" />
                Switch to 3 Columns
              </Button>
              <Separator className="my-1" />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs gap-2 text-destructive hover:text-destructive"
                onClick={() => {
                  // Delete the columns block
                  const { from } = editor.state.selection
                  const $pos = editor.state.doc.resolve(from)
                  for (let d = $pos.depth; d > 0; d--) {
                    const node = $pos.node(d)
                    if (node.type.name === 'columns') {
                      editor.chain().focus().deleteRange({
                        from: $pos.before(d),
                        to: $pos.after(d),
                      }).run()
                      break
                    }
                  }
                  setOpen(false)
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete Columns
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Table Popover ──────────────────────────────────────────────────────────
function TablePopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)

  const isInTable = editor.isActive('table')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                'hover:bg-muted',
                isInTable && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <TableIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Table
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-56 p-3"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <div className="space-y-2">
          <Label className="text-xs font-medium">Table</Label>

          {!isInTable ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                setOpen(false)
              }}
            >
              <Plus className="h-3.5 w-3.5 me-1.5" />
              Insert 3×3 Table
            </Button>
          ) : (
            <>
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().addRowBefore().run()
                  }}
                >
                  <PlusCircle className="h-3.5 w-3.5 me-1.5" />
                  Add Row Before
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().addRowAfter().run()
                  }}
                >
                  <PlusCircle className="h-3.5 w-3.5 me-1.5" />
                  Add Row After
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().deleteRow().run()
                  }}
                >
                  <MinusCircle className="h-3.5 w-3.5 me-1.5" />
                  Delete Row
                </Button>
              </div>

              <Separator />

              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().addColumnBefore().run()
                  }}
                >
                  <PlusCircle className="h-3.5 w-3.5 me-1.5" />
                  Add Column Before
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().addColumnAfter().run()
                  }}
                >
                  <PlusCircle className="h-3.5 w-3.5 me-1.5" />
                  Add Column After
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => {
                    editor.chain().focus().deleteColumn().run()
                  }}
                >
                  <MinusCircle className="h-3.5 w-3.5 me-1.5" />
                  Delete Column
                </Button>
              </div>

              <Separator />

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs text-destructive"
                onClick={() => {
                  editor.chain().focus().deleteTable().run()
                  setOpen(false)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 me-1.5" />
                Delete Table
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Font Size Dropdown ────────────────────────────────────────────────────
const FONT_SIZE_OPTIONS = [
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
  { label: '36', value: '36px' },
  { label: '48', value: '48px' },
]

function FontSizeDropdown({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const currentFontSize = editor.getAttributes('textStyle').fontSize || ''

  const currentLabel = currentFontSize
    ? FONT_SIZE_OPTIONS.find((o) => o.value === currentFontSize)?.label || currentFontSize.replace('px', '')
    : '\u2014'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center gap-1 h-8 px-2 rounded-md text-sm font-medium transition-colors',
                'hover:bg-muted',
                currentFontSize && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <span className="w-6 text-center">{currentLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Font Size
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-32 p-1"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        <button
          type="button"
          onClick={() => {
            editor.chain().focus().unsetFontSize().run()
            setOpen(false)
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted',
            !currentFontSize && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
          )}
        >
          <span>Default</span>
          {!currentFontSize && <Check className="h-3 w-3 ms-auto" />}
        </button>
        {FONT_SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              editor.chain().focus().setFontSize(opt.value).run()
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted',
              currentFontSize === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
            )}
          >
            <span>{opt.label}</span>
            {currentFontSize === opt.value && <Check className="h-3 w-3 ms-auto" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ─── Font Family Dropdown ──────────────────────────────────────────────────
const FONT_FAMILY_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
]

function FontFamilyDropdown({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || ''

  const currentLabel = currentFontFamily
    ? FONT_FAMILY_OPTIONS.find((o) => o.value === currentFontFamily)?.label || 'Custom'
    : 'Default'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'inline-flex items-center gap-1 h-8 px-2 rounded-md text-sm font-medium transition-colors',
                'hover:bg-muted max-w-[120px]',
                currentFontFamily && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
              )}
            >
              <span className="truncate max-w-[80px]">{currentLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Font Family
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-44 p-1"
        align={dir === 'rtl' ? 'end' : 'start'}
        sideOffset={4}
      >
        {FONT_FAMILY_OPTIONS.map((opt) => (
          <button
            key={opt.value || 'default'}
            type="button"
            onClick={() => {
              if (opt.value) {
                editor.chain().focus().setFontFamily(opt.value).run()
              } else {
                editor.chain().focus().unsetFontFamily().run()
              }
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted',
              currentFontFamily === opt.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
            )}
            style={opt.value ? { fontFamily: opt.value } : undefined}
          >
            <span>{opt.label}</span>
            {currentFontFamily === opt.value && <Check className="h-3 w-3 ms-auto" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ─── Code Block Popover with Language Selector ─────────────────────────────
const CODE_LANGUAGES = [
  { label: 'Plain Text', value: 'plaintext' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'PHP', value: 'php' },
  { label: 'C#', value: 'csharp' },
  { label: 'Java', value: 'java' },
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'SQL', value: 'sql' },
  { label: 'MySQL', value: 'mysql' },
  { label: 'Bash', value: 'bash' },
  { label: 'JSON', value: 'json' },
]

function CodeBlockPopover({
  editor,
  dir,
}: {
  editor: Editor
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isInCodeBlock = editor.isActive('codeBlock')
  const currentLang = editor.getAttributes('codeBlock').language || 'plaintext'
  const currentLangLabel = CODE_LANGUAGES.find((l) => l.value === currentLang)?.label || currentLang

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false)
      }
    }
    // Use pointerdown for immediate response
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((prev) => !prev)}
            className={cn(
              'inline-flex items-center justify-center h-8 rounded-md transition-colors',
              'hover:bg-muted',
              isInCodeBlock && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
              isInCodeBlock ? 'w-auto px-2 gap-1' : 'w-8'
            )}
          >
            <Code className="h-4 w-4" />
            {isInCodeBlock && (
              <span className="text-[10px] font-medium max-w-[60px] truncate">{currentLangLabel}</span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Code Block
        </TooltipContent>
      </Tooltip>

      {/* Custom dropdown - avoids Radix Popover focus conflicts with TipTap editor */}
      {open && (
        <div
          className={cn(
            'absolute top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'max-h-72 overflow-y-auto',
            dir === 'rtl' ? 'right-0' : 'left-0'
          )}
        >
          {!isInCodeBlock ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().toggleCodeBlock().run()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <Code className="h-4 w-4" />
              <span>Insert Code Block</span>
            </button>
          ) : (
            <>
              <Label className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Language</Label>
              {CODE_LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().updateAttributes('codeBlock', { language: lang.value }).run()
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                    currentLang === lang.value && 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  )}
                >
                  <span>{lang.label}</span>
                  {currentLang === lang.value && <Check className="h-3 w-3 ms-auto" />}
                </button>
              ))}
              <Separator className="my-1" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().toggleCodeBlock().run()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-muted"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove Code Block</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
