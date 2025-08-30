'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, X, Filter, Calendar, FileText, Hash, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import debounce from 'lodash/debounce'

interface SearchResult {
  id: string
  note_id?: string
  panel_id?: string
  title?: string
  note_title?: string
  content?: string
  excerpt?: string
  rank?: number
  similarity?: number
  type?: string
  original_text?: string
  created_at?: string
  updated_at?: string
}

interface SearchResults {
  query: string
  type: string
  results: {
    notes?: { items: SearchResult[], count: number }
    documents?: { items: SearchResult[], count: number }
    branches?: { items: SearchResult[], count: number }
    fuzzy?: { items: SearchResult[], count: number }
  }
  totalCount: number
}

interface SearchPanelProps {
  onSelectResult?: (result: SearchResult) => void
  className?: string
}

export function SearchPanel({ onSelectResult, className }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchType, setSearchType] = useState<'all' | 'notes' | 'documents' | 'branches' | 'fuzzy'>('all')
  const [sortBy, setSortBy] = useState<'relevance' | 'date_asc' | 'date_desc'>('relevance')
  const [showFilters, setShowFilters] = useState(false)
  
  // Debounced search function
  const performSearch = useMemo(
    () =>
      debounce(async (searchQuery: string, type: string, sort: string) => {
        if (!searchQuery.trim()) {
          setResults(null)
          setError(null)
          return
        }
        
        setLoading(true)
        setError(null)
        
        try {
          const params = new URLSearchParams({
            q: searchQuery,
            type,
            limit: '20',
            offset: '0'
          })
          
          const response = await fetch(`/api/search?${params}`)
          
          if (!response.ok) {
            throw new Error(`Search failed: ${response.statusText}`)
          }
          
          const data = await response.json()
          setResults(data)
        } catch (err) {
          console.error('Search error:', err)
          setError(err instanceof Error ? err.message : 'Search failed')
          setResults(null)
        } finally {
          setLoading(false)
        }
      }, 300),
    []
  )
  
  // Trigger search when query or filters change
  useEffect(() => {
    performSearch(query, searchType, sortBy)
  }, [query, searchType, sortBy, performSearch])
  
  // Clear search
  const handleClear = useCallback(() => {
    setQuery('')
    setResults(null)
    setError(null)
  }, [])
  
  // Format date for display
  const formatDate = (dateString?: string) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // Calculate relevance percentage
  const getRelevancePercent = (rank?: number, similarity?: number) => {
    if (similarity !== undefined) {
      return Math.round(similarity * 100)
    }
    if (rank !== undefined) {
      // Convert rank to percentage (rank is between 0 and 1)
      return Math.round(rank * 100)
    }
    return 0
  }
  
  // Render search result item
  const renderResultItem = (result: SearchResult, type: string) => {
    const relevance = getRelevancePercent(result.rank, result.similarity)
    
    return (
      <Card
        key={`${type}-${result.id}`}
        className="mb-2 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => onSelectResult?.(result)}
      >
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Title */}
              <div className="flex items-center gap-2 mb-1">
                {type === 'notes' && <FileText className="w-4 h-4 text-muted-foreground" />}
                {type === 'documents' && <FileText className="w-4 h-4 text-blue-500" />}
                {type === 'branches' && <Hash className="w-4 h-4 text-green-500" />}
                <h4 className="font-medium text-sm truncate">
                  {result.title || result.note_title || `${type} ${result.id.slice(0, 8)}`}
                </h4>
              </div>
              
              {/* Excerpt with highlights */}
              {result.excerpt && (
                <div 
                  className="text-sm text-muted-foreground line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: result.excerpt }}
                />
              )}
              
              {/* Metadata */}
              <div className="flex items-center gap-2 mt-2">
                {relevance > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {relevance}% match
                  </Badge>
                )}
                {result.type && (
                  <Badge variant="secondary" className="text-xs">
                    {result.type}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDate(result.updated_at || result.created_at)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }
  
  return (
    <div className={`w-full max-w-4xl ${className}`}>
      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          type="text"
          placeholder="Search notes, documents, and annotations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-20"
        />
        
        {/* Clear button */}
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-12 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        
        {/* Filter dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 px-2"
            >
              <Filter className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Search Type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSearchType('all')}>
              All Content
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSearchType('notes')}>
              Notes Only
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSearchType('documents')}>
              Documents Only
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSearchType('branches')}>
              Annotations Only
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSearchType('fuzzy')}>
              Fuzzy Search
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSortBy('relevance')}>
              Relevance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('date_desc')}>
              Newest First
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('date_asc')}>
              Oldest First
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Loading State */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      
      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">Error: {error}</p>
          </CardContent>
        </Card>
      )}
      
      {/* Results */}
      {results && !loading && (
        <div>
          {/* Results Summary */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">
              Found {results.totalCount} results for "{results.query}"
            </p>
            <Badge variant="outline">
              {searchType === 'all' ? 'All' : searchType}
            </Badge>
          </div>
          
          {/* Results Tabs */}
          {results.totalCount > 0 ? (
            <Tabs defaultValue={Object.keys(results.results)[0]} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                {results.results.notes && (
                  <TabsTrigger value="notes">
                    Notes ({results.results.notes.count})
                  </TabsTrigger>
                )}
                {results.results.documents && (
                  <TabsTrigger value="documents">
                    Documents ({results.results.documents.count})
                  </TabsTrigger>
                )}
                {results.results.branches && (
                  <TabsTrigger value="branches">
                    Annotations ({results.results.branches.count})
                  </TabsTrigger>
                )}
                {results.results.fuzzy && (
                  <TabsTrigger value="fuzzy">
                    Fuzzy ({results.results.fuzzy.count})
                  </TabsTrigger>
                )}
              </TabsList>
              
              <ScrollArea className="h-[400px] mt-4">
                {results.results.notes && (
                  <TabsContent value="notes" className="mt-0">
                    {results.results.notes.items.map(item => 
                      renderResultItem(item, 'notes')
                    )}
                  </TabsContent>
                )}
                
                {results.results.documents && (
                  <TabsContent value="documents" className="mt-0">
                    {results.results.documents.items.map(item => 
                      renderResultItem(item, 'documents')
                    )}
                  </TabsContent>
                )}
                
                {results.results.branches && (
                  <TabsContent value="branches" className="mt-0">
                    {results.results.branches.items.map(item => 
                      renderResultItem(item, 'branches')
                    )}
                  </TabsContent>
                )}
                
                {results.results.fuzzy && (
                  <TabsContent value="fuzzy" className="mt-0">
                    {results.results.fuzzy.items.map(item => 
                      renderResultItem(item, 'fuzzy')
                    )}
                  </TabsContent>
                )}
              </ScrollArea>
            </Tabs>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No results found for "{results.query}"
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Try different keywords or use fuzzy search for better results
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      
      {/* Empty State */}
      {!query && !results && (
        <Card>
          <CardContent className="p-8 text-center">
            <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">
              Start typing to search across all your content
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Use filters to narrow down your search
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}