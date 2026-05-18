import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import ChatInput, { type ChatInputHandle } from "~/components/chat/ChatInput"
import MessageList from "~/components/chat/MessageList"
import WelcomeHeader from "~/components/chat/WelcomeHeader"
import { MessageCarrier } from "~/components/chat/MessageCarrier"
import { useAccount } from "~/context/AccountContext"
import {
  addChat,
  deleteChat,
  getChat,
  updateChat,
  type Chat,
} from "~/backend/ChatBackend"
import {
  addMessage,
  closeMessageEventSource,
  getChatMessages,
  getMessageAnswer,
  updateMessage,
  type Message,
} from "~/backend/MessageBackend"
import {
  getProviderDisplayName,
  getProviderLogoUrl,
  type Provider,
} from "~/backend/ProviderBackend"
import { renderReason, renderText } from "~/lib/ChatMessageRender"
import { getIsDark, getRandomName } from "~/lib/chatUtils"

type UploadedFile = {
  uid: number
  file: File
  content: string
  value: string
}

type Props = {
  provider: Provider
  stableProviderName: string
  beforeSend: () => Promise<void>
}

function getChatName(stableProviderName: string) {
  return `chat_${stableProviderName}`
}

function buildChat(
  provider: Provider,
  stableProviderName: string,
  accountName: string,
  organization?: string
): Chat {
  return {
    owner: "admin",
    name: getChatName(stableProviderName),
    displayName: provider.displayName || provider.name,
    createdTime: new Date().toISOString(),
    organization,
    store: "",
    user: accountName,
    modelProvider: provider.name,
    needTitle: true,
    messageCount: 0,
    category: "ModelTest",
  }
}

export default function ModelTestWidget({
  provider,
  stableProviderName,
  beforeSend,
}: Props) {
  const { t } = useTranslation()
  const { account } = useAccount()
  const [chat, setChat] = useState<Chat | undefined>()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [isReading] = useState(false)
  const [isLoadingTTS] = useState(false)
  const [readingMessage] = useState<string | undefined>()
  const [isVoiceInput] = useState(false)
  const messageListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<ChatInputHandle>(null)
  const providerRef = useRef(provider)
  const isDark = getIsDark()

  const chatName = getChatName(stableProviderName || provider.name)

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  function scrollToBottom() {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight
    }
  }

  function updateChatDisplayName(title: string, targetChat: Chat) {
    if (!title) return
    setChat((current) =>
      current?.name === targetChat.name
        ? { ...current, displayName: title, needTitle: false }
        : current
    )
  }

  const loadMessages = useCallback(
    (targetChat: Chat) => {
      setMessageError(false)
      getChatMessages("admin", targetChat.name)
        .then((res) => {
          if (res.status !== "ok") {
            setMessageLoading(false)
            setMessageError(true)
            toast.error(`${t("general:Failed to get")}: ${res.msg}`)
            return
          }

          const loadedMessages: Message[] = res.data || []
          loadedMessages.forEach((message) => {
            message.html = renderText(message.text)
            if (message.reasonText)
              message.reasonHtml = renderReason(message.reasonText)
          })
          setMessages(loadedMessages)

          if (loadedMessages.length > 0) {
            const lastMessage = loadedMessages[loadedMessages.length - 1]
            if (
              lastMessage.author === "AI" &&
              lastMessage.replyTo !== "" &&
              lastMessage.text === ""
            ) {
              if (lastMessage.errorText) {
                setMessageLoading(false)
                setMessageError(true)
                return
              }

              setMessageLoading(true)
              let text = ""
              let reasonText = ""
              const carrier = new MessageCarrier(targetChat.needTitle)

              getMessageAnswer(
                lastMessage.owner,
                lastMessage.name,
                (data) => {
                  const json = JSON.parse(data)
                  if (json.text === "") json.text = "\n"
                  text += json.text
                  const parsed = carrier.parseAnswerWithCarriers(text)
                  updateChatDisplayName(parsed.title, targetChat)

                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    const last = { ...updated[updated.length - 1] }
                    last.text = parsed.finalAnswer
                    last.html = renderText(last.text)
                    last.isReasoningPhase = false
                    updated[updated.length - 1] = last
                    return updated
                  })
                },
                (data) => {
                  const json = JSON.parse(data)
                  if (json.text === "") json.text = "\n"
                  reasonText += json.text
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    const last = { ...updated[updated.length - 1] }
                    last.reasonText = reasonText
                    if (!last.toolCalls?.length) last.isReasoningPhase = true
                    if (text) last.text = text
                    updated[updated.length - 1] = last
                    return updated
                  })
                },
                (data) => {
                  const json = JSON.parse(data)
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    const last = { ...updated[updated.length - 1] }
                    const toolCalls = [...(last.toolCalls || [])]
                    if (!json.content) {
                      toolCalls.push({
                        name: json.name,
                        arguments: json.arguments,
                        content: "",
                      })
                    } else {
                      let found = false
                      for (let i = toolCalls.length - 1; i >= 0; i--) {
                        if (
                          toolCalls[i].name === json.name &&
                          !toolCalls[i].content
                        ) {
                          toolCalls[i] = {
                            name: json.name,
                            arguments: json.arguments,
                            content: json.content,
                          }
                          found = true
                          break
                        }
                      }
                      if (!found)
                        toolCalls.push({
                          name: json.name,
                          arguments: json.arguments,
                          content: json.content,
                        })
                    }
                    last.toolCalls = toolCalls
                    updated[updated.length - 1] = last
                    return updated
                  })
                },
                (data) => {
                  const searchResults = JSON.parse(data)
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      searchResults,
                    }
                    return updated
                  })
                },
                (data) => {
                  const vectorScores = JSON.parse(data)
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      vectorScores,
                    }
                    return updated
                  })
                },
                (error) => {
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      errorText: error,
                    }
                    return updated
                  })
                  setMessageLoading(false)
                  setMessageError(true)
                  toast.error(error)
                },
                () => {
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    const last = { ...updated[updated.length - 1] }
                    const parsed = carrier.parseAnswerWithCarriers(text)
                    last.text = parsed.finalAnswer
                    last.suggestions = parsed.suggestionArray
                    last.html = renderText(last.text)
                    if (last.reasonText)
                      last.reasonHtml = renderReason(last.reasonText)
                    last.isReasoningPhase = false
                    updated[updated.length - 1] = last
                    return updated
                  })
                  setMessageLoading(false)
                  setMessageError(false)
                  setTimeout(scrollToBottom, 50)
                },
                (infoText) => {
                  setMessages((prev) => {
                    if (!prev.length) return prev
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      hintText: infoText,
                    }
                    return updated
                  })
                }
              )
            } else {
              setMessageLoading(false)
            }
          } else {
            setMessageLoading(false)
          }

          setTimeout(scrollToBottom, 50)
        })
        .catch((err) => {
          setMessageLoading(false)
          setMessageError(true)
          toast.error(`${t("general:Failed to get")}: ${err}`)
        })
    },
    [t]
  )

  const createChat = useCallback(async () => {
    if (!account?.name) return undefined

    const currentProvider = providerRef.current
    const newChat = buildChat(
      currentProvider,
      stableProviderName || currentProvider.name,
      account.name,
      account.owner
    )
    const res = await addChat(newChat)
    if (res.status !== "ok") {
      throw new Error(res.msg || t("general:Failed to add"))
    }
    const createdChat: Chat = res.data || newChat
    setChat(createdChat)
    setMessages([])
    setMessageError(false)
    setMessageLoading(false)
    return createdChat
  }, [account?.name, account?.owner, stableProviderName, t])

  const loadOrCreateChat = useCallback(async () => {
    if (!account?.name) return

    setLoading(true)
    try {
      const res = await getChat("admin", chatName)
      if (res.status === "ok" && res.data) {
        const loadedChat: Chat = res.data
        const currentProvider = providerRef.current
        const updatedChat: Chat = {
          ...loadedChat,
          store: "",
          category: "ModelTest",
          modelProvider: currentProvider.name,
          displayName:
            loadedChat.displayName ||
            currentProvider.displayName ||
            currentProvider.name,
        }
        setChat(updatedChat)
        if (
          loadedChat.store !== updatedChat.store ||
          loadedChat.category !== updatedChat.category ||
          loadedChat.modelProvider !== updatedChat.modelProvider ||
          loadedChat.displayName !== updatedChat.displayName
        ) {
          updateChat(updatedChat.owner, updatedChat.name, updatedChat).catch(
            () => {}
          )
        }
        loadMessages(updatedChat)
      } else {
        await createChat()
      }
    } catch (err) {
      try {
        await createChat()
      } catch (createErr) {
        toast.error((createErr as Error).message || String(err))
      }
    } finally {
      setLoading(false)
    }
  }, [account?.name, chatName, createChat, loadMessages])

  useEffect(() => {
    loadOrCreateChat()
  }, [loadOrCreateChat])

  useEffect(() => {
    setChat((current) => {
      if (!current || current.modelProvider === provider.name) return current
      return {
        ...current,
        modelProvider: provider.name,
        store: "",
        category: "ModelTest",
      }
    })
    if (webSearchEnabled) setWebSearchEnabled(false)
  }, [provider.name])

  async function resetChat() {
    try {
      setMessageLoading(false)
      if (chat) {
        const res = await deleteChat(chat)
        if (res.status !== "ok")
          throw new Error(res.msg || t("general:Failed to delete"))
      }
      await createChat()
      setInputValue("")
      setFiles([])
      setWebSearchEnabled(false)
      setTimeout(() => inputRef.current?.focus(), 100)
      toast.success(t("chat:New Chat"))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function sendMessage(
    text: string,
    fileName = "",
    isHidden = false,
    isRegenerated = false,
    wsEnabled = false
  ) {
    if (!account?.name) return

    let targetChat = chat
    if (!targetChat) {
      try {
        targetChat = await createChat()
      } catch (err) {
        toast.error((err as Error).message)
        return
      }
    }
    if (!targetChat) return

    try {
      await beforeSend()
    } catch (err) {
      toast.error((err as Error).message)
      return
    }

    const syncedChat: Chat = {
      ...targetChat,
      store: "",
      category: "ModelTest",
      modelProvider: provider.name,
    }
    targetChat = syncedChat
    setChat(syncedChat)
    updateChat(syncedChat.owner, syncedChat.name, syncedChat).catch(() => {})

    let fullText = text
    files.forEach((file) => {
      fullText = `${file.value}\n${fullText}`
    })

    const randomName = getRandomName()
    const newMessage: Partial<Message> = {
      owner: "admin",
      name: `message_${randomName}`,
      createdTime: new Date().toISOString(),
      organization: account.owner,
      store: "",
      user: account.name,
      chat: targetChat.name,
      replyTo: "",
      author: account.name,
      text: fullText,
      isHidden,
      isDeleted: false,
      isAlerted: false,
      isRegenerated,
      fileName: fileName || (files[0]?.file.name ?? ""),
      webSearchEnabled: wsEnabled,
      modelProvider: provider.name,
    }

    setMessageError(false)
    addMessage(newMessage)
      .then((res) => {
        if (res.status !== "ok") {
          setMessageError(true)
          toast.error(`${t("general:Failed to add")}: ${res.msg}`)
          return
        }

        const returnedChat: Chat = {
          ...res.data,
          store: "",
          category: "ModelTest",
          modelProvider: provider.name,
        }
        setChat(returnedChat)
        setInputValue("")
        setFiles([])
        loadMessages(returnedChat)
      })
      .catch((err) => {
        setMessageError(true)
        toast.error(`${t("general:Failed to connect to server")}: ${err}`)
      })
  }

  function handleSend(text: string, wsEnabled: boolean) {
    sendMessage(text, "", false, false, wsEnabled)
  }

  function handleRegenerate() {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.author !== "AI")
    if (!lastUserMessage) return
    handleEditMessage(
      { ...lastUserMessage, createdTime: new Date().toISOString() },
      true
    )
  }

  async function handleEditMessage(message: Message, silent = false) {
    try {
      await beforeSend()
    } catch (err) {
      toast.error((err as Error).message)
      return
    }

    if (chat) {
      const syncedChat: Chat = {
        ...chat,
        store: "",
        category: "ModelTest",
        modelProvider: provider.name,
      }
      setChat(syncedChat)
      updateChat(syncedChat.owner, syncedChat.name, syncedChat).catch(() => {})
    }

    const editedMessage: Partial<Message> = {
      ...message,
      createdTime: new Date().toISOString(),
      store: "",
      webSearchEnabled,
      modelProvider: provider.name,
    }
    addMessage(editedMessage).then((res) => {
      if (res.status === "ok") {
        if (!silent) toast.success(t("general:Successfully saved"))
        const returnedChat: Chat = {
          ...res.data,
          store: "",
          category: "ModelTest",
          modelProvider: provider.name,
        }
        setChat(returnedChat)
        loadMessages(returnedChat)
      } else {
        toast.error(`${t("general:Failed to add")}: ${res.msg}`)
      }
    })
  }

  function handleCancelMessage() {
    if (!messages.length) return
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.author === "AI" && messageLoading) {
      closeMessageEventSource(lastMessage.owner, lastMessage.name)
      updateMessage(lastMessage.owner, lastMessage.name, lastMessage).then(
        (res) => {
          if (res.status === "ok") setMessageLoading(false)
          else toast.error(`${t("general:Failed to save")}: ${res.msg}`)
        }
      )
    }
  }

  function handleMessageLike(message: Message, type: "like" | "dislike") {
    const opposite = type === "like" ? "dislike" : "like"
    const isCancel =
      message[`${type}Users`]?.includes(account?.name ?? "") ?? false

    const updated = { ...message }
    if (isCancel) {
      updated[`${type}Users`] = (updated[`${type}Users`] || []).filter(
        (user) => user !== account?.name
      )
    } else {
      updated[`${type}Users`] = [
        ...(updated[`${type}Users`] || []),
        account?.name ?? "",
      ]
    }
    updated[`${opposite}Users`] = (updated[`${opposite}Users`] || []).filter(
      (user) => user !== account?.name
    )

    setMessages((prev) =>
      prev.map((m) => (m.name === message.name ? updated : m))
    )
    updateMessage(message.owner, message.name, updated).then((res) => {
      if (res.status === "ok") {
        toast.success(
          type === "like"
            ? isCancel
              ? t("general:Successfully unliked")
              : t("general:Successfully liked")
            : isCancel
              ? t("general:Successfully undisliked")
              : t("general:Successfully disliked")
        )
      } else {
        toast.error(res.msg)
      }
    })
  }

  function copyMessageText(message: Message) {
    const parts: string[] = []
    if (message.toolCalls?.length) {
      message.toolCalls.forEach((toolCall) => {
        let part = `Tool calls\n${toolCall.name}`
        try {
          part += `\nArguments:\n${JSON.stringify(JSON.parse(toolCall.arguments), null, 2)}`
        } catch {
          part += `\nArguments:\n${toolCall.arguments}`
        }
        if (toolCall.content) {
          try {
            part += `\nResult:\n${JSON.stringify(JSON.parse(toolCall.content), null, 2)}`
          } catch {
            part += `\nResult:\n${toolCall.content}`
          }
        }
        parts.push(part)
      })
    }

    const div = document.createElement("div")
    div.innerHTML = message.text || ""
    const text = div.innerText
    if (text) parts.push(text)
    navigator.clipboard.writeText(parts.join("\n\n")).then(() => {
      toast.success(t("general:Successfully copied"))
    })
  }

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded border">
        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const chatDisplayName =
    chat?.displayName || provider.displayName || provider.name

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded border bg-background">
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2"
        style={{
          background: isDark ? "rgba(20,20,20,0.9)" : "rgba(255,255,255,0.9)",
        }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {chatDisplayName}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
            <img
              src={getProviderLogoUrl(provider)}
              alt={provider.name}
              className="h-4 w-4 shrink-0 object-contain"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = "none"
              }}
            />
            <span className="max-w-48 truncate">
              {getProviderDisplayName(provider) || provider.name}
            </span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetChat}>
            <PlusIcon className="h-4 w-4" />
            {t("chat:New Chat")}
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto">
            <WelcomeHeader store={undefined} />
          </div>
        ) : (
          <MessageList
            ref={messageListRef}
            messages={messages}
            account={account}
            store={undefined}
            onRegenerate={handleRegenerate}
            onMessageLike={handleMessageLike}
            onCopyMessage={copyMessageText}
            onToggleRead={() => {}}
            onEditMessage={handleEditMessage}
            isReading={isReading}
            isLoadingTTS={isLoadingTTS}
            readingMessage={readingMessage}
            sendMessage={(text, fileName) => sendMessage(text, fileName || "")}
            files={files}
          />
        )}

        <ChatInput
          ref={inputRef}
          value={inputValue}
          store={undefined}
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
  )
}
