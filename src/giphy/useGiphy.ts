import { useContext } from 'react'
import { GiphyContext } from './GiphyContext'

export const useGiphy = () => {
  const ctx = useContext( GiphyContext )
  if( !ctx ) {
    throw new Error( 'useGiphy must be used within GiphyProvider' )
  }
  return ctx
}
