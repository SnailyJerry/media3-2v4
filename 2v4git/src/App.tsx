import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Settings, Upload, Copy, Send, Loader2, Clipboard, Eye, EyeOff, AlertTriangle, Pause, Play } from "lucide-react"
import { toast } from "@/components/ui/use-toast"

const API_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const API_BATCH_SIZE = 5
const API_RATE_LIMIT = 3
const MAX_RETRIES = 3

function SystemSettings({ settings, setSettings }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [showApiKey, setShowApiKey] = useState(false)

  const handleSave = () => {
    setSettings(localSettings)
    toast({
      title: "设置已保存",
      description: "您的系统设置已成功更新。",
    })
  }

  const toggleApiKeyVisibility = () => {
    setShowApiKey(!showApiKey)
  }

  const maskApiKey = (key) => {
    if (!key) return ''
    return '*'.repeat(Math.max(0, key.length - 4)) + key.slice(-4)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="api-key" className="text-right">
              API Key
            </Label>
            <div className="col-span-3 flex">
              <Input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                value={showApiKey ? localSettings.apiKey : maskApiKey(localSettings.apiKey)}
                onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
                className="flex-grow"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={toggleApiKeyVisibility}
                className="ml-2"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="model" className="text-right">
              模型
            </Label>
            <Select
              value={localSettings.model}
              onValueChange={(value) => setLocalSettings({ ...localSettings, model: value })}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="glm-4v-plus">GLM-4V Plus</SelectItem>
                <SelectItem value="glm-4v">GLM-4V</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="temperature" className="text-right">
              温度
            </Label>
            <div className="col-span-3 flex items-center gap-4">
              <Slider
                id="temperature"
                min={0}
                max={1}
                step={0.1}
                value={[localSettings.temperature]}
                onValueChange={([value]) => setLocalSettings({ ...localSettings, temperature: value })}
                className="flex-grow"
              />
              <span className="w-12 text-right">{localSettings.temperature.toFixed(1)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="max-tokens" className="text-right">
              最大Token
            </Label>
            <Input
              id="max-tokens"
              type="number"
              value={localSettings.maxTokens}
              onChange={(e) => setLocalSettings({ ...localSettings, maxTokens: parseInt(e.target.value) })}
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave}>保存设置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function SnailyMediaReader() {
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState([])
  const [urls, setUrls] = useState([''])
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [settings, setSettings] = useState({
    apiKey: '',
    model: 'glm-4v-plus',
    temperature: 0.7,
    maxTokens: 300
  })
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const abortControllerRef = useRef(null)

  useEffect(() => {
    const handleSecurityPolicyViolation = (e) => {
      console.error('Content Security Policy violation:', e)
      setError('Content Security Policy violation detected. Please check your browser settings.')
    }
    document.addEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    return () => {
      document.removeEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    }
  }, [])

  const handleUrlChange = (index, value) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const addUrlInput = () => {
    setUrls([...urls, ''])
  }

  const removeUrlInput = (index) => {
    const newUrls = urls.filter((_, i) => i !== index)
    setUrls(newUrls)
  }

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files)
    setFiles(selectedFiles)
  }

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = (error) => reject(error)
    })
  }

  const processMediaBatch = async (batch, batchIndex) => {
    const batchResults = await Promise.all(batch.map(async (item) => {
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          let mediaContent
          if (item instanceof File) {
            const base64 = await fileToBase64(item)
            mediaContent = {
              type: item.type.startsWith('image/') ? 'image_url' : 'video_url',
              [item.type.startsWith('image/') ? 'image_url' : 'video_url']: {
                url: `data:${item.type};base64,${base64}`
              }
            }
          } else {
            mediaContent = {
              type: item.toLowerCase().endsWith('.mp4') ? 'video_url' : 'image_url',
              [item.toLowerCase().endsWith('.mp4') ? 'video_url' : 'image_url']: {
                url: item
              }
            }
          }

          console.log('Sending request to API:', JSON.stringify({
            model: settings.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  mediaContent
                ]
              }
            ],
            max_tokens: settings.maxTokens,
            temperature: settings.temperature
          }, null, 2))

          const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
              model: settings.model,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    mediaContent
                  ]
                }
              ],
              max_tokens: settings.maxTokens,
              temperature: settings.temperature
            })
          })

          if (!response.ok) {
            const errorText = await response.text()
            console.error('API response not OK:', response.status, errorText)
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
          }

          const data = await response.json()
          console.log('API response:', JSON.stringify(data, null, 2))

          if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            throw new Error('Invalid API response format')
          }

          return { url: item instanceof File ? item.name : item, result: data.choices[0].message.content }
        } catch (error) {
          console.error('Error processing media:', item, error)
          retries++
          if (retries >= MAX_RETRIES) {
            return { url: item instanceof File ? item.name : item, result: `Error: ${error.message}` }
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * retries))
        }
      }
    }))

    setResults(prevResults => [...prevResults, ...batchResults])
    setProgress((batchIndex + 1) * API_BATCH_SIZE * 100 / (files.length + urls.filter(url => url.trim() !== '').length))
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)
    setResults([])
    setProgress(0)
    setIsPaused(false)

    const allMedia = [...files, ...urls.filter(url => url.trim() !== '')]
    const batches = []
    for (let i = 0; i < allMedia.length; i += API_BATCH_SIZE) {
      batches.push(allMedia.slice(i, i + API_BATCH_SIZE))
    }

    abortControllerRef.current = new AbortController()

    try {
      for (let i = 0; i < batches.length; i++) {
        if (isPaused) {
          await new Promise(resolve => {
            const checkPaused = () => {
              if (!isPaused) {
                resolve()
              } else {
                setTimeout(checkPaused, 100)
              }
            }
            checkPaused()
          })
        }

        if (abortControllerRef.current.signal.aborted) {
          break
        }

        await processMediaBatch(batches[i], i)

        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 60000 / API_RATE_LIMIT))
        }
      }
    } catch (error) {
      console.error('Error:', error)
      setError(error.message || '处理请求时发生错误。请检查您的设置并重试。')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = () => {
    setIsPaused(true)
  }

  const handleResume = () => {
    setIsPaused(false)
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setIsLoading(false)
    setIsPaused(false)
  }

  const handlePaste = useCallback((e) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const pastedUrls = pastedText.split(/\s+/).filter(url => url.trim() !== '')
    setUrls(pastedUrls)
  }, [])

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <h1 className="text-3xl font-bold text-center mb-8">SnailyMediaReader</h1>
      <p className="text-center text-lg mb-8 text-muted-foreground">用文字看见图片和视频</p>
      
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>错误</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              上传设置
              <SystemSettings settings={settings} setSettings={setSettings} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="file" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file">文件上传</TabsTrigger>
                <TabsTrigger value="url">URL 链接</TabsTrigger>
              </TabsList>
              <TabsContent value="file">
                <div className="space-y-4">
                  <Textarea 
                    placeholder="请输入提示词" 
                    className="w-full" 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="flex items-center justify-center w-full">
                    <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-bray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-600">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-8 h-8 mb-4 text-gray-500 dark:text-gray-400" />
                        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400"><span className="font-semibold">点击上传</span> 或拖拽文件到这里</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">支持PNG, JPG, GIF 或 MP4 (最大. 20MB)</p>
                      </div>
                      <input id="dropzone-file" type="file" className="hidden" onChange={handleFileChange} multiple accept="image/*,video/*" />
                    </label>
                  </div>
                  {files.length > 0 && (
                    <div className="mt-4">
                      <h3 className="font-semibold mb-2">已选择的文件：</h3>
                      <ul className="list-disc pl-5">
                        {files.map((file, index) => (
                          <li key={index}>{file.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="url">
                <div className="space-y-4">
                  <Textarea 
                    placeholder="请输入提示词" 
                    className="w-full" 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="flex items-center space-x-2">
                    <Textarea
                      placeholder="粘贴多个URL，每行一个"
                      className="w-full"
                      rows={5}
                      onPaste={handlePaste}
                      value={urls.join('\n')}
                      onChange={(e) => setUrls(e.target.value.split('\n'))}
                    />
                    <Button onClick={() => setUrls([])} variant="outline">
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                  {urls.map((url, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <Input
                        type="url"
                        placeholder={`URL #${index + 1}`}
                        value={url}
                        onChange={(e) => handleUrlChange(index, e.target.value)}
                      />
                      {index === urls.length - 1 ? (
                        <Button onClick={addUrlInput} variant="outline">+</Button>
                      ) : (
                        <Button onClick={() => removeUrlInput(index)} variant="outline">-</Button>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
            <div className="mt-4 space-y-2">
              <Progress value={progress} className="w-full" />
              <div className="flex justify-between">
                <Button onClick={handleSubmit} disabled={isLoading || isPaused}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {isLoading ? '处理中...' : '提交'}
                </Button>
                {isLoading && (
                  <>
                    {isPaused ? (
                      <Button onClick={handleResume}>
                        <Play className="mr-2 h-4 w-4" />
                        继续
                      </Button>
                    ) : (
                      <Button onClick={handlePause}>
                        <Pause className="mr-2 h-4 w-4" />
                        暂停
                      </Button>
                    )}
                    <Button onClick={handleStop} variant="destructive">
                      停止
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {results.length > 0 ? (
                results.map((result, index) => (
                  <Card key={index} className="p-4">
                    <h3 className="font-semibold mb-2">结果 {index + 1}:</h3>
                    <p className="text-sm text-muted-foreground mb-2 break-all">{result.url}</p>
                    <Textarea 
                      value={result.result} 
                      readOnly 
                      className="w-full mt-2"
                    />
                  </Card>
                ))
              ) : (
                <p className="text-center text-muted-foreground">结果将在这里显示...</p>
              )}
            </div>
            {results.length > 0 && (
              <Button className="w-full mt-4" onClick={() => navigator.clipboard.writeText(results.map(r => `URL: ${r.url}\n结果: ${r.result}`).join('\n\n'))}>
                <Copy className="mr-2 h-4 w-4" /> 一键复制所有结果
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}