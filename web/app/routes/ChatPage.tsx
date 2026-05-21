import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "~/components/ui/button"
import { Sheet, SheetContent } from "~/components/ui/sheet"
import { Skeleton } from "~/components/ui/skeleton"
import ChatMenu, { type ChatMenuHandle } from "~/components/chat/ChatMenu"
import ChatInput, { type ChatInputHandle } from "~/components/chat/ChatInput"
import MessageList from "~/components/chat/MessageList"
import WelcomeHeader from "~/components/chat/WelcomeHeader"
import { getFirstUserMessageText } from "~/carrier/titleUtils"
import type { ChatStreamUpdate } from "~/backend/MessageBackend"
import { useAccount } from "~/context/AccountContext"
import { getChats, deleteChat, updateChat } from "~/backend/ChatBackend"
import { getChatMessages, addMessage, updateMessage, closeMessageEventSource } from "~/backend/MessageBackend"
import { getGlobalStores } from "~/backend/StoreBackend"
import { renderText } from "~/lib/ChatMessageRender"
import { getRandomName, isMobile } from "~/lib/chatUtils"
import type { Chat } from "~/backend/ChatBackend"
import type { Message } from "~/backend/MessageBackend"
import type { Store } from "~/backend/StoreBackend"
import { useMessageStream } from "~/hooks/useMessageStream"
import { useChatMessageHandlers } from "~/hooks/useChatMessageHandlers"
import { useTts } from "~/hooks/useTts"
import { useStoreFilter } from "~/hooks/useStoreFilter"
import { useDeclareStoreFilter } from "~/context/StoreFilterContext"

type UploadedFile = {
  uid: number
  file: File
  content: string
  value: string
}

export default function ChatPage() {
  useDeclareStoreFilter(true)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { chatName: chatNameParam, storeName: storeNameParam } = useParams<{
    chatName?: string
    storeName?: string
  }>()
  const { account } = useAccount()
  const storeFilter = useStoreFilter()

  useEffect(() => {
    if (storeNameParam) {
      try { localStorage.setItem("store", storeNameParam) } catch {}
      window.dispatchEvent(new Event("globalStoreChanged"))
    }
  }, [storeNameParam])

  // State
  const [chats, setChats] = useState<Chat[]>([])
  const [chat, setChat] = useState<Chat | undefined>()
  const [messages, setMessages] = useState<Message[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [defaultStore, setDefaultStore] = useState<Store | undefined>()
  const [loading, setLoading] = useState(true)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState(false)
  const [chatMenuCollapsed, setChatMenuCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("chatMenuCollapsed") || "false") } catch { return false }
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [draftStoreName, setDraftStoreName] = useState<string | undefined>(storeFilter)

  // Input state (lifted up from ChatBox)
  const [inputValue, setInputValue] = useState("")
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const { isReading, isLoadingTTS, readingMessage, handleToggleRead } = useTts()
  const [isVoiceInput, setIsVoiceInput] = useState(false)

  // Refs
  const menuRef = useRef<ChatMenuHandle>(null)
  const inputRef = useRef<ChatInputHandle>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const inputStore = useRef(new Map<string | undefined, string>())
  const streamOwnerRef = useRef("")
  const streamNameRef = useRef("")
  const chatsLoadedRef = useRef(false)
  const latestMessageChatRef = useRef("")

  const streamAnswer = useMessageStream(setMessages, setMessageLoading, setMessageError)
  const { handleMessageLike, copyMessageText } = useChatMessageHandlers(setMessages)

  // ── Helpers ──────────────────────────────────────────────────────────

  function scrollToBottom() {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight
    }
  }

  function generateChatUrl(cName?: string, sName?: string, owner = "admin"): string {
    const effectiveSName = sName || storeNameParam || storeFilter
    if (!effectiveSName) {
      return cName ? `/chat/${cName}` : "/chat"
    }
    return cName ? `/${owner}/${effectiveSName}/chat/${cName}` : `/${owner}/${effectiveSName}/chat`
  }

  function getCurrentStore(): Store | undefined {
    if (!chat && !draftStoreName) return defaultStore
    const sName = chat?.store || draftStoreName
    return stores.find((s) => s.name === sName) || defaultStore
  }

  // ── Data loading ──────────────────────────────────────────────────────

  const fetchStores = useCallback(() => {
    getGlobalStores().then((res) => {
      if (res.status === "ok") {
        const all: Store[] = res.data || []
        const def = all.find((s) => s.isDefault)
        setStores(all)
        setDefaultStore(def)
      }
    })
  }, [])

  const loadMessages = useCallback(
    (targetChat: Chat) => {
      setMessageError(false)
      latestMessageChatRef.current = targetChat.name
      getChatMessages("admin", targetChat.name).then((res) => {
        if (latestMessageChatRef.current !== targetChat.name) return
        if (res.status !== "ok") return
        const msgs: Message[] = res.data || []

        msgs.forEach((m) => {
          m.html = renderText(m.text)
        })
        setMessages(msgs)

        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg.author === "AI" && lastMsg.replyTo !== "" && lastMsg.text === "") {
            if (lastMsg.errorText) {
              setMessageLoading(false)
              setMessageError(true)
              return
            }
            streamOwnerRef.current = lastMsg.owner
            streamNameRef.current = lastMsg.name
            streamAnswer(lastMsg, targetChat, {
              userTextForTitle: getFirstUserMessageText(msgs),
              onTitle: updateChatDisplayName,
              onChat: (update) => applyChatUpdateFromServer(update, targetChat),
              onDone: () => {
                streamOwnerRef.current = ""
                streamNameRef.current = ""
              },
            })
          } else {
            setMessageLoading(false)
          }
        }

        setTimeout(scrollToBottom, 50)
      })
    },
    [streamAnswer]
  )

  function updateChatDisplayName(title: string, targetChat: Chat) {
    if (!title) return
    setChats((prev) =>
      prev.map((c) => (c.name === targetChat.name ? { ...c, displayName: title, needTitle: false } : c))
    )
    setChat((prev) =>
      prev?.name === targetChat.name ? { ...prev, displayName: title, needTitle: false } : prev
    )
  }

  function applyChatUpdateFromServer(update: ChatStreamUpdate, targetChat: Chat) {
    if (!update?.name || update.name !== targetChat.name || !update.displayName) return
    setChats((prev) =>
      prev.map((c) =>
        c.name === update.name
          ? {
              ...c,
              displayName: update.displayName ?? c.displayName,
              needTitle: update.needTitle ?? false,
            }
          : c
      )
    )
    setChat((prev) =>
      prev?.name === update.name
        ? {
            ...prev,
            displayName: update.displayName ?? prev.displayName,
            needTitle: update.needTitle ?? false,
          }
        : prev
    )
  }

  const fetchChats = useCallback(() => {
    if (!account?.name) return
    const shouldShowPageLoading = !chatsLoadedRef.current
    if (shouldShowPageLoading) setLoading(true)

    const effectiveStore = (storeNameParam || storeFilter) ?? ""
    getChats(account.name, effectiveStore, -1, -1, "user", account.name).then((res) => {
      if (res.status !== "ok") {
        chatsLoadedRef.current = true
        setLoading(false)
        return
      }

      const fetchedChats: Chat[] = res.data || []
      setChats(fetchedChats)
      chatsLoadedRef.current = true
      setLoading(false)

      if (!chatNameParam) {
        latestMessageChatRef.current = ""
        setChat(undefined)
        setMessages([])
        setDraftStoreName(storeNameParam || storeFilter)
        menuRef.current?.clearSelectedKey()
        fetchStores()
        return
      }

      const targetChat = fetchedChats.find((c) => c.name === chatNameParam)
      if (!targetChat) {
        latestMessageChatRef.current = ""
        setChat(undefined)
        setMessages([])
        setDraftStoreName(storeNameParam || storeFilter)
        menuRef.current?.clearSelectedKey()
        navigate(generateChatUrl(undefined, storeNameParam || storeFilter), { replace: true })
        fetchStores()
        return
      }

      setChat(targetChat)
      setDraftStoreName(targetChat.store)
      loadMessages(targetChat)
      fetchStores()
    })
  }, [account?.name, chatNameParam, storeNameParam, storeFilter])

  useEffect(() => {
    fetchChats()
  }, [fetchChats])

  // Keep inputStore in sync with current input so cleanup doesn't need a stale-closure workaround
  useEffect(() => {
    inputStore.current.set(chat?.name, inputValue)
  }, [inputValue, chat?.name])

  // Close the active SSE stream when the chat changes
  useEffect(() => {
    return () => {
      if (streamOwnerRef.current) {
        closeMessageEventSource(streamOwnerRef.current, streamNameRef.current)
        streamOwnerRef.current = ""
        streamNameRef.current = ""
      }
    }
  }, [chat?.name])

  // ── Actions ───────────────────────────────────────────────────────────

  function sendMessage(text: string, fileName = "", isHidden = false, isRegenerated = false, wsEnabled = false) {
    if (!account) return

    // Prepend file values
    let fullText = text
    files.forEach((f) => { fullText = f.value + "\n" + fullText })

    const randomName = getRandomName()
    const newMessage: Partial<Message> = {
      owner: "admin",
      name: `message_${randomName}`,
      createdTime: new Date().toISOString(),
      organization: account.owner,
      store: chat?.store || draftStoreName || storeNameParam || storeFilter || defaultStore?.name || "",
      user: account.name,
      chat: chat?.name,
      replyTo: "",
      author: account.name,
      text: fullText,
      isHidden,
      isDeleted: false,
      isAlerted: false,
      isRegenerated,
      fileName: fileName || (files[0]?.file.name ?? ""),
      webSearchEnabled: wsEnabled,
      modelProvider: chat?.modelProvider || getCurrentStore()?.modelProvider,
    }

    addMessage(newMessage).then((res) => {
      if (res.status !== "ok") {
        toast.error(`${t("general:Failed to add")}: ${res.msg}`)
        return
      }

      const returnedChat: Chat = res.data
      setChat(returnedChat)
      setDraftStoreName(returnedChat.store)
      setInputValue("")
      setFiles([])
      navigate(generateChatUrl(returnedChat.name, returnedChat.store), { replace: true })

      // Refresh chat list
      getChats(account.name, (storeNameParam || storeFilter) ?? "", -1, -1, "user", account.name).then((r) => {
        if (r.status === "ok") {
          setChats(r.data || [])
          menuRef.current?.setSelectedKeyToChat(r.data || [], returnedChat.name)
        }
      })

      loadMessages(returnedChat)
    }).catch((err) => {
      toast.error(`${t("general:Failed to connect to server")}: ${err}`)
    })
  }

  function handleSend(text: string, wsEnabled: boolean) {
    sendMessage(text, "", false, false, wsEnabled)
  }

  function handleRegenerate(_index: number) {
    const lastUserMsg = [...messages].reverse().find((m) => m.author !== "AI")
    if (!lastUserMsg) return
    handleEditMessage({ ...lastUserMsg, createdTime: new Date().toISOString() }, true)
  }

  function handleEditMessage(message: Message, silent = false) {
    const editedMessage: Partial<Message> = {
      ...message,
      createdTime: new Date().toISOString(),
      store: getCurrentStore()?.name,
      webSearchEnabled,
      modelProvider: chat?.modelProvider || getCurrentStore()?.modelProvider,
    }
    addMessage(editedMessage).then((res) => {
      if (res.status === "ok") {
        if (!silent) toast.success(t("general:Successfully saved"))
        loadMessages(res.data)
      } else {
        toast.error(`${t("general:Failed to add")}: ${res.msg}`)
      }
    })
  }

  function handleCancelMessage() {
    if (!messages.length) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg.author === "AI" && messageLoading) {
      closeMessageEventSource(lastMsg.owner, lastMsg.name)
      streamOwnerRef.current = ""
      streamNameRef.current = ""
      updateMessage(lastMsg.owner, lastMsg.name, lastMsg).then((res) => {
        if (res.status === "ok") setMessageLoading(false)
      })
    }
  }

  function handleSelectChat(index: number) {
    const selected = chats[index]
    if (!selected) return
    setChat(selected)
    setDraftStoreName(selected.store)
    setMessageError(false)
    setMessageLoading(false)
    setFiles([])
    setMobileMenuOpen(false)
    loadMessages(selected)
    navigate(generateChatUrl(selected.name, selected.store), { replace: true })
    // Restore input
    const savedInput = inputStore.current.get(selected.name) || ""
    setInputValue(savedInput)
  }

  function handleAddChat(store?: Store) {
    const sName = store?.name || storeNameParam || storeFilter || ""
    latestMessageChatRef.current = ""
    setChat(undefined)
    setMessages([])
    setMessageError(false)
    setDraftStoreName(sName)
    setInputValue("")
    setFiles([])
    setMobileMenuOpen(false)
    navigate(generateChatUrl(undefined, sName), { replace: true })
    menuRef.current?.clearSelectedKey()
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function handleDeleteChat(index: number) {
    const chatToDelete = chats[index]
    deleteChat(chatToDelete).then((res) => {
      if (res.status !== "ok") {
        toast.error(`${t("general:Failed to delete")}: ${res.msg}`)
        return
      }
      toast.success(t("general:Successfully deleted"))
      const newChats = chats.filter((_, i) => i !== index)
      setChats(newChats)

      if (newChats.length === 0) {
        latestMessageChatRef.current = ""
        setChat(undefined)
        setMessages([])
        navigate("/chat", { replace: true })
      } else {
        const next = newChats[Math.min(index, newChats.length - 1)]
        setChat(next)
        setDraftStoreName(next.store)
        loadMessages(next)
        navigate(generateChatUrl(next.name, next.store), { replace: true })
      }
    })
  }

  function handleUpdateChatName(index: number, newName: string) {
    const c = chats[index]
    const updated = { ...c, displayName: newName }
    updateChat("admin", c.name, updated).then((res) => {
      if (res.status === "ok") {
        toast.success(t("general:Successfully saved"))
        setChats((prev) => prev.map((x, i) => (i === index ? updated : x)))
        if (chat?.name === c.name) setChat(updated)
      } else {
        toast.error(`${t("general:Failed to save")}: ${res.msg}`)
      }
    })
  }

  function toggleCollapse() {
    const next = !chatMenuCollapsed
    setChatMenuCollapsed(next)
    localStorage.setItem("chatMenuCollapsed", JSON.stringify(next))
  }

  // ── Render ────────────────────────────────────────────────────────────

  const mobile = isMobile()
  const currentStore = getCurrentStore()

  const sidebarContent = (
    <ChatMenu
      ref={menuRef}
      chats={chats}
      chatName={chat?.name}
      onSelectChat={handleSelectChat}
      onAddChat={handleAddChat}
      onDeleteChat={handleDeleteChat}
      onUpdateChatName={handleUpdateChatName}
      stores={stores}
      currentStoreName={storeNameParam || storeFilter}
    />
  )

  if (loading) {
    return (
      <div className="flex h-[calc(100svh-104px)] min-h-0 gap-3 overflow-hidden p-4">
        <div className="w-60 shrink-0 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-16 ${i % 2 ? "ml-auto w-2/3" : "w-3/4"}`} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100svh-104px)] min-h-0 overflow-hidden">
      {/* Desktop sidebar */}
      {!mobile && !chatMenuCollapsed && (
        <div className="bg-muted/40 flex min-h-0 w-60 shrink-0 flex-col border-r">
          {sidebarContent}
        </div>
      )}

      {/* Mobile sidebar as Sheet */}
      {mobile && (
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="h-svh w-64 p-0">
            {sidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="supports-[backdrop-filter]:bg-background/80 flex shrink-0 items-center gap-1 border-b bg-background/95 px-2 py-1 backdrop-blur-sm">
          {mobile ? (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileMenuOpen(true)}>
              <MenuIcon className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleCollapse}>
              {chatMenuCollapsed ? (
                <PanelLeftOpenIcon className="h-4 w-4" />
              ) : (
                <PanelLeftCloseIcon className="h-4 w-4" />
              )}
            </Button>
          )}

          {chat ? (
            <span className="flex-1 truncate text-sm font-medium">
              {chat.displayName || chat.name}
            </span>
          ) : (
            <div className="flex-1" />
          )}
        </div>

        {/* Messages */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* Background logo watermark */}
          {messages.length > 0 && (
            <div
              className="pointer-events-none absolute inset-0 bg-center bg-no-repeat opacity-[0.04]"
              style={{
                backgroundImage: `url(https://cdn.openagentai.org/img/openagent-logo_1900x450.png)`,
                backgroundSize: "200px auto",
              }}
            />
          )}

          <div className="flex h-full min-h-0 flex-col">
            {messages.length === 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <WelcomeHeader store={currentStore} />
              </div>
            ) : (
              <MessageList
                ref={messageListRef}
                messages={messages}
                account={account}
                store={currentStore}
                onRegenerate={handleRegenerate}
                onMessageLike={handleMessageLike}
                onCopyMessage={copyMessageText}
                onToggleRead={(m) => handleToggleRead(m, currentStore)}
                onEditMessage={handleEditMessage}
                isReading={isReading}
                isLoadingTTS={isLoadingTTS}
                readingMessage={readingMessage}
                sendMessage={(text, fileName) => sendMessage(text, fileName || "")}
                files={files}
                hideThinking={currentStore?.hideThinking}
              />
            )}

            <ChatInput
              ref={inputRef}
              value={inputValue}
              store={currentStore}
              chat={chat}
              files={files}
              onFileChange={setFiles}
              onChange={setInputValue}
              onSend={handleSend}
              loading={messageLoading}
              messageError={messageError}
              onCancelMessage={handleCancelMessage}
              webSearchEnabled={webSearchEnabled}
              onWebSearchChange={setWebSearchEnabled}
              isVoiceInput={isVoiceInput}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
